// Configure these values in Apps Script Project Settings > Script Properties.
// Required: BOOKING_CALENDAR_ID, NOTIFY_EMAIL.
// Optional: BLOCKING_CALENDAR_IDS, TIME_ZONE, WEBHOOK_SECRET, WEB_APP_URL,
// MANUAL_BOOKING_KEY, PRIVATE_BOOKING_DETAILS_CALENDAR_ID.
const DEFAULT_TIME_ZONE = "America/Los_Angeles";
const PENDING_BOOKING_PREFIX = "PENDING_BOOKING_";
const PENDING_BOOKING_TTL_DAYS = 45;
const MIN_BOOKING_DURATION_MINUTES = 120;

function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};

  if (params.action === "confirm") {
    return handleBookingConfirmation(params.token);
  }

  if (params.action === "decline") {
    return handleBookingDecline(params.token);
  }

  if (params.action === "manual") {
    return handleManualBookingForm(params);
  }

  if (params.action === "add_manual") {
    return handleManualBookingCreate(params);
  }

  if (params.action === "availability") {
    return handleAvailabilityRequest(params);
  }

  return renderResult(
    "Booking webhook is live",
    "This Google Apps Script deployment is reachable. Submit the booking form, then use the emailed confirmation link to create a calendar hold."
  );
}

function doPost(e) {
  try {
    const params = normalizeSubmission(
      Object.assign({}, e && e.parameter ? e.parameter : {})
    );

    if (params.action === "add_manual") {
      return handleManualBookingCreate(params);
    }

    return handleBookingPost(e);
  } catch (error) {
    const notifyEmail = getOptionalScriptProperty("NOTIFY_EMAIL");

    if (notifyEmail) {
      MailApp.sendEmail({
        to: notifyEmail,
        subject: "Booking calendar webhook error",
        body: error && error.stack ? error.stack : String(error),
      });
    }

    return renderResult(
      "Booking error",
      "The booking request was received, but it could not be processed. Frannie has been notified."
    );
  }
}

function testCalendarWrite() {
  const config = getBookingConfig();
  const bookingDay = todayInTimeZone(config.timeZone);
  const calendar = CalendarApp.getCalendarById(config.bookingCalendarId);

  if (!calendar) {
    throw new Error("Calendar not found: " + config.bookingCalendarId);
  }

  const event = calendar.createAllDayEvent(
    "TEST: Website booking calendar write",
    bookingDay,
    {
      description:
        "Delete this all-day event after confirming the website booking calendar can be written by Apps Script.",
    }
  );
  event.setColor(CalendarApp.EventColor.YELLOW);

  return event.getId();
}

function handleBookingPost(e) {
  const config = getBookingConfig();

  if (!isAuthorizedWebhook(e, config)) {
    return renderResult(
      "Unauthorized",
      "This booking webhook could not be verified."
    );
  }

  const params = extractSubmission(e);

  if (isSpamSubmission(params)) {
    return renderResult("Thanks!", "Your request has been received.");
  }

  const requiredFields = [
    "name",
    "email",
    "date",
    "event_time",
    "duration",
    "location",
  ];
  const missing = requiredFields.filter((field) => !params[field]);

  if (missing.length) {
    return renderResult(
      "Missing details",
      "Please go back and fill in: " + missing.join(", ") + "."
    );
  }

  const start = buildDate(params.date, params.event_time);
  const durationMinutes = parseDurationMinutes(params.duration);

  if (
    !isValidDate(start) ||
    Number.isNaN(durationMinutes)
  ) {
    return renderResult(
      "Invalid time",
      "Please go back and choose a valid event date, start time, and a duration of at least 2 hours."
    );
  }

  const end = addMinutes(start, durationMinutes);

  if (start.getTime() < Date.now()) {
    return renderResult(
      "Invalid time",
      "Please go back and choose a future event date and start time."
    );
  }

  const conflicts = getConflicts(
    startOfDay(start),
    startOfNextDay(start),
    config.blockingCalendarIds
  );

  if (conflicts.length) {
    return renderResult(
      "Date already booked",
      "Frannie already has a calendar conflict on this date. Please go back and choose another date, or call Frannie if this date is important."
    );
  }

  const pending = storePendingBooking(params, start, end, conflicts.length);

  cleanupOldPendingBookings();
  sendManualReviewNotifications(pending, config);

  return renderResult(
    "Request received",
    "Your request was received. Frannie will review it before adding anything to the calendar."
  );
}

function handleBookingConfirmation(token) {
  if (!isValidToken(token)) {
    return renderResult("Invalid link", "This confirmation link is not valid.");
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const pending = getPendingBooking(token);

    if (!pending) {
      return renderResult(
        "Request not found",
        "This booking request may have already been handled or expired."
      );
    }

    const config = getBookingConfig();
    const start = new Date(pending.startIso);
    const end = new Date(pending.endIso);

    if (!isValidDate(start) || !isValidDate(end) || start >= end) {
      deletePendingBooking(token);
      return renderResult(
        "Invalid request",
        "This saved booking request had an invalid date or time and was cleared."
      );
    }

    const bookingCalendar = CalendarApp.getCalendarById(
      config.bookingCalendarId
    );

    if (!bookingCalendar) {
      return renderResult(
        "Calendar unavailable",
        "Frannie's calendar could not be reached. Please check the calendar ID and try again."
      );
    }

    const bookingDay = pendingBookingDay(pending, config);

    if (!bookingDay) {
      return renderResult(
        "Invalid request",
        "This saved booking request did not include a usable booking date. No calendar block was created."
      );
    }

    const conflicts = getConflicts(
      bookingDay,
      startOfNextDay(bookingDay),
      config.blockingCalendarIds
    );

    if (conflicts.length) {
      return renderResult(
        "Date already booked",
        "The calendar has " +
          conflicts.length +
          " conflict(s) on " +
          formatDateOnly(bookingDay, config.timeZone) +
          ". No public booked block was created."
      );
    }

    const params = pending.params;
    let event;

    try {
      event = bookingCalendar.createAllDayEvent(
        calendarEventTitle(params),
        bookingDay,
        {
          location: "San Diego, CA",
          description: calendarEventDescription(params, pending),
        }
      );
    } catch (error) {
      MailApp.sendEmail({
        to: config.notifyEmail,
        replyTo: params.email,
        subject: "Booking calendar write failed: " + eventTitle(params),
        body:
          submissionSummary(pending, config) +
          "\n\nThe confirm link was clicked, but Apps Script could not create the Google Calendar block." +
          "\nRequested booked date: " +
          formatDateOnly(bookingDay, config.timeZone) +
          "\n\nError:\n" +
          (error && error.stack ? error.stack : String(error)),
      });

      return renderResult(
        "Calendar write failed",
        "The request is still pending, but Apps Script could not create the Google Calendar block. Frannie has been emailed the error."
      );
    }

    try {
      event.setColor(CalendarApp.EventColor.GRAY);
    } catch (error) {
      // The calendar block is the source of truth; color is only a visual hint.
    }

    deletePendingBooking(token);
    sendConfirmedNotifications(pending, config, event.getId());

    return renderResult(
      "Date marked booked",
      "This booking date is now marked as booked on Frannie's public calendar for " +
        formatDateOnly(bookingDay, config.timeZone) +
        ". Calendar event ID: " +
        event.getId()
    );
  } finally {
    lock.releaseLock();
  }
}

function handleBookingDecline(token) {
  if (!isValidToken(token)) {
    return renderResult("Invalid link", "This decline link is not valid.");
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const pending = getPendingBooking(token);

    if (!pending) {
      return renderResult(
        "Request not found",
        "This booking request may have already been handled or expired."
      );
    }

    const config = getBookingConfig();
    deletePendingBooking(token);
    sendDeclinedNotifications(pending, config);

    return renderResult(
      "Request declined",
      "The booking request was cleared and no calendar hold was created."
    );
  } finally {
    lock.releaseLock();
  }
}

function handleManualBookingForm(params) {
  const config = getBookingConfig();

  if (!isAuthorizedManualBooking(params, config)) {
    return renderResult(
      "Manual booking unavailable",
      "This private phone booking helper is not configured or the link is not valid."
    );
  }

  return renderManualBookingForm(config, params.manual_key);
}

function handleManualBookingCreate(params) {
  const config = getBookingConfig();
  params = normalizeSubmission(params || {});

  if (!isAuthorizedManualBooking(params, config)) {
    return renderResult(
      "Manual booking unavailable",
      "This private phone booking helper is not configured or the link is not valid."
    );
  }

  const bookingDay = parseDateOnly(params.date);
  const start = buildDate(params.date, params.event_time);
  const durationMinutes = parseDurationMinutes(params.duration);

  if (!bookingDay || bookingDay < startOfDay(new Date())) {
    return renderResult(
      "Invalid date",
      "Please choose today or a future date for the phone booking hold."
    );
  }

  if (
    !isValidDate(start) ||
    Number.isNaN(durationMinutes)
  ) {
    return renderResult(
      "Invalid time",
      "Please choose a valid start time and a duration of at least 2 hours for the phone booking."
    );
  }

  const end = addMinutes(start, durationMinutes);

  if (start.getTime() < Date.now()) {
    return renderResult(
      "Invalid time",
      "Please choose a future date and start time for the phone booking."
    );
  }

  const conflicts = getConflicts(
    bookingDay,
    startOfNextDay(bookingDay),
    config.blockingCalendarIds
  );

  if (conflicts.length) {
    return renderResult(
      "Date already booked",
      "That date already has a calendar conflict, so no new phone booking hold was created."
    );
  }

  const bookingCalendar = CalendarApp.getCalendarById(config.bookingCalendarId);
  const detailsCalendar = config.privateBookingDetailsCalendarId
    ? CalendarApp.getCalendarById(config.privateBookingDetailsCalendarId)
    : null;

  if (!bookingCalendar) {
    return renderResult(
      "Calendar unavailable",
      "Frannie's calendar could not be reached. Please check the calendar ID and try again."
    );
  }

  if (config.privateBookingDetailsCalendarId && !detailsCalendar) {
    return renderResult(
      "Private calendar unavailable",
      "The private booking details calendar could not be reached. No public booked block was created."
    );
  }

  const event = bookingCalendar.createAllDayEvent("Booked", bookingDay, {
    location: "San Diego, CA",
    description: manualBookingDescription(params),
  });
  event.setColor(CalendarApp.EventColor.GRAY);

  const detailsEvent = detailsCalendar
    ? detailsCalendar.createEvent(manualBookingPrivateTitle(params), start, end, {
        location: params.location || "San Diego, CA",
        description: manualBookingPrivateDescription(params, event.getId(), config),
      })
    : null;

  MailApp.sendEmail({
    to: config.notifyEmail,
    subject: "Phone booking date marked booked",
    body: manualBookingEmailBody(params, start, end, config, event, detailsEvent),
  });

  return renderResult(
    "Phone booking added",
    "This date is now marked as booked on Frannie's public calendar."
  );
}

function handleAvailabilityRequest(params) {
  const requestedCallback = String(params.callback || "");
  const callback = isValidJsonpCallback(requestedCallback)
    ? requestedCallback
    : "";
  const payload = getAvailabilityPayload(params);
  const body = callback
    ? callback + "(" + JSON.stringify(payload) + ");"
    : JSON.stringify(payload);
  const output = ContentService.createTextOutput(body);

  return output.setMimeType(
    callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON
  );
}

function isValidJsonpCallback(callback) {
  return /^[A-Za-z_$][0-9A-Za-z_$]*(\.[A-Za-z_$][0-9A-Za-z_$]*)*$/.test(
    callback
  );
}

function getAvailabilityPayload(params) {
  const config = getBookingConfig();
  const today = startOfDay(new Date());
  const requestedStart = parseDateOnly(params.start) || today;
  const requestedEnd = parseDateOnly(params.end);
  const start = requestedStart < today ? today : requestedStart;
  const maxEnd = addDays(start, 370);
  let end = requestedEnd || addDays(start, 32);

  if (end <= start) {
    end = addDays(start, 32);
  }

  if (end > maxEnd) {
    end = maxEnd;
  }

  return {
    start: formatDateOnly(start, config.timeZone),
    end: formatDateOnly(end, config.timeZone),
    bookedDates: getPublicBookedDateStrings(start, end, config),
    generatedAt: new Date().toISOString(),
  };
}

function getBookingConfig() {
  const bookingCalendarId = getRequiredScriptProperty("BOOKING_CALENDAR_ID");
  const notifyEmail = getRequiredScriptProperty("NOTIFY_EMAIL");
  const blockingCalendarIds =
    getCsvScriptProperty("BLOCKING_CALENDAR_IDS") || [bookingCalendarId];

  return {
    bookingCalendarId,
    blockingCalendarIds,
    notifyEmail,
    timeZone: getOptionalScriptProperty("TIME_ZONE") || DEFAULT_TIME_ZONE,
    webhookSecret: getOptionalScriptProperty("WEBHOOK_SECRET"),
    manualBookingKey: getOptionalScriptProperty("MANUAL_BOOKING_KEY"),
    privateBookingDetailsCalendarId: getOptionalScriptProperty(
      "PRIVATE_BOOKING_DETAILS_CALENDAR_ID"
    ),
    webAppUrl: normalizeWebAppUrl(getOptionalScriptProperty("WEB_APP_URL")),
  };
}

function getRequiredScriptProperty(name) {
  const value = getOptionalScriptProperty(name);

  if (!value) {
    throw new Error("Missing Apps Script property: " + name);
  }

  return value;
}

function getOptionalScriptProperty(name) {
  return PropertiesService.getScriptProperties().getProperty(name) || "";
}

function getCsvScriptProperty(name) {
  const value = getOptionalScriptProperty(name);

  if (!value) {
    return null;
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeWebAppUrl(value) {
  return String(value || "")
    .trim()
    .replace(/\/macros\/u\/\d+\/s\//, "/macros/s/");
}

function isAuthorizedWebhook(e, config) {
  if (!config.webhookSecret) {
    return true;
  }

  const params = e && e.parameter ? e.parameter : {};
  return params.booking_key === config.webhookSecret;
}

function isAuthorizedManualBooking(params, config) {
  return Boolean(
    config.manualBookingKey && params.manual_key === config.manualBookingKey
  );
}

function extractSubmission(e) {
  const params = Object.assign({}, e && e.parameter ? e.parameter : {});
  const payload = parseJsonPostData(e);

  // Formspark sends webhook payloads as a plain JSON object with the submitted
  // field names at the top level. The other shapes keep local tests flexible.
  // Some webhook providers wrap form fields under payload.submission.
  if (
    payload &&
    payload.submission &&
    typeof payload.submission === "object"
  ) {
    return normalizeSubmission(Object.assign(params, payload.submission));
  }

  if (payload && payload.data && typeof payload.data === "object") {
    return normalizeSubmission(Object.assign(params, payload.data));
  }

  if (payload && typeof payload === "object") {
    return normalizeSubmission(Object.assign(params, payload));
  }

  return normalizeSubmission(params);
}

function normalizeSubmission(rawParams) {
  return Object.keys(rawParams).reduce((params, key) => {
    let value = rawParams[key];

    if (Array.isArray(value)) {
      value = value.join(", ");
    } else if (value && typeof value === "object") {
      value = JSON.stringify(value);
    }

    params[key] = String(value || "").trim();
    return params;
  }, {});
}

function isSpamSubmission(params) {
  return Boolean(params._gotcha || params._honeypot || params.website);
}

function parseJsonPostData(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return null;
  }

  try {
    return JSON.parse(e.postData.contents);
  } catch (error) {
    return null;
  }
}

function getConflicts(start, end, calendarIds) {
  return calendarIds.flatMap((calendarId) => {
    const calendar = CalendarApp.getCalendarById(calendarId);
    return calendar ? calendar.getEvents(start, end) : [];
  });
}

function getBookedDateStrings(start, end, config) {
  const bookedDates = {};

  config.blockingCalendarIds.forEach((calendarId) => {
    const calendar = CalendarApp.getCalendarById(calendarId);

    if (!calendar) {
      return;
    }

    calendar.getEvents(start, end).forEach((event) => {
      addBookedEventDates(bookedDates, event, start, end, config.timeZone);
    });
  });

  return Object.keys(bookedDates).sort();
}

function getPublicBookedDateStrings(start, end, config) {
  return getBookedDateStrings(start, end, {
    blockingCalendarIds: [config.bookingCalendarId],
    timeZone: config.timeZone,
  });
}

function addBookedEventDates(bookedDates, event, rangeStart, rangeEnd, timeZone) {
  const eventStart = event.getStartTime();
  const eventEnd = event.getEndTime();
  const start = eventStart > rangeStart ? eventStart : rangeStart;
  const end = eventEnd < rangeEnd ? eventEnd : rangeEnd;

  if (end <= start) {
    return;
  }

  let day = startOfDay(start);
  const finalDay = startOfDay(new Date(end.getTime() - 1));

  while (day <= finalDay) {
    bookedDates[formatDateOnly(day, timeZone)] = true;
    day = addDays(day, 1);
  }
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfNextDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function parseDateOnly(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const parts = match.slice(1).map(Number);
  const date = new Date(parts[0], parts[1] - 1, parts[2]);

  return isValidDate(date) ? date : null;
}

function formatDateOnly(date, timeZone) {
  return Utilities.formatDate(date, timeZone, "yyyy-MM-dd");
}

function todayInTimeZone(timeZone) {
  return parseDateOnly(formatDateOnly(new Date(), timeZone));
}

function buildDate(date, time) {
  const dateMatch = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = String(time || "").match(/^([01]\d|2[0-3]):([0-5]\d)$/);

  if (!dateMatch || !timeMatch) {
    return new Date("invalid");
  }

  const parts = dateMatch.slice(1).map(Number);
  const timeParts = timeMatch.slice(1).map(Number);

  return new Date(
    parts[0],
    parts[1] - 1,
    parts[2],
    timeParts[0],
    timeParts[1],
    0
  );
}

function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function parseDurationMinutes(value) {
  const minutes = Number(value);

  if (
    Number.isNaN(minutes) ||
    minutes < MIN_BOOKING_DURATION_MINUTES
  ) {
    return NaN;
  }

  return minutes;
}

function eventTitle(params) {
  const eventType = params.event_type || "Event";
  return params.name ? eventType + " for " + params.name : eventType;
}

function calendarEventTitle(params) {
  return "Booked";
}

function storePendingBooking(params, start, end, conflictCount) {
  const token = Utilities.getUuid().replace(/-/g, "");
  const pending = {
    token,
    params,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    conflictCount,
    createdAtIso: new Date().toISOString(),
  };
  const storedPending = Object.assign({}, pending, {
    params: storedPendingParams(params),
  });

  PropertiesService.getScriptProperties().setProperty(
    PENDING_BOOKING_PREFIX + token,
    JSON.stringify(storedPending)
  );

  return pending;
}

function storedPendingParams(params) {
  return {
    date: params.date,
    email: params.email,
    event_time: params.event_time,
    event_type: params.event_type,
    guests: params.guests,
    duration: params.duration,
  };
}

function getPendingBooking(token) {
  const value = PropertiesService.getScriptProperties().getProperty(
    PENDING_BOOKING_PREFIX + token
  );

  return value ? JSON.parse(value) : null;
}

function deletePendingBooking(token) {
  PropertiesService.getScriptProperties().deleteProperty(
    PENDING_BOOKING_PREFIX + token
  );
}

function cleanupOldPendingBookings() {
  const properties = PropertiesService.getScriptProperties();
  const cutoff = Date.now() - PENDING_BOOKING_TTL_DAYS * 24 * 60 * 60 * 1000;
  const values = properties.getProperties();

  Object.keys(values).forEach((key) => {
    if (key.indexOf(PENDING_BOOKING_PREFIX) !== 0) {
      return;
    }

    try {
      const pending = JSON.parse(values[key]);
      const createdAt = new Date(pending.createdAtIso).getTime();

      if (!createdAt || createdAt < cutoff) {
        properties.deleteProperty(key);
      }
    } catch (error) {
      properties.deleteProperty(key);
    }
  });
}

function isValidToken(token) {
  return /^[A-Za-z0-9]{20,}$/.test(String(token || ""));
}

function pendingBookingDay(pending, config) {
  const params = pending && pending.params ? pending.params : {};
  const start = new Date(pending.startIso);

  return (
    parseDateOnly(params.date) ||
    parseDateOnly(formatDateOnly(start, config.timeZone))
  );
}

function eventDescription(params, pending) {
  return [
    "Booking request from the website",
    pending ? "Submitted: " + pending.createdAtIso : "",
    "",
    "Name: " + (params.name || "Not stored after initial approval email"),
    "Email: " + params.email,
    "Phone: " + (params.phone || "Not stored after initial approval email"),
    "Event type: " + (params.event_type || "Not provided"),
    "Guest count: " + (params.guests || "Not provided"),
    "Cross streets: " +
      (params.location || "Not stored after initial approval email"),
    "",
    "Message:",
    params.message || "Not stored after initial approval email",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function calendarEventDescription(params, pending) {
  return [
    "Website booking date",
    "Status: Booked",
    pending ? "Submitted: " + pending.createdAtIso : "",
    "Event type: " + (params.event_type || "Not provided"),
    "Guest count: " + (params.guests || "Not provided"),
    "Customer details are kept in Formspark and Frannie's approval email.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function manualBookingDescription(params) {
  return [
    "Phone booking date",
    "Status: Booked",
    "Added: " + new Date().toISOString(),
    "Event type: " + (params.event_type || "Not provided"),
    "Guest count: " + (params.guests || "Not provided"),
    "Customer details are kept outside the public calendar.",
  ].join("\n");
}

function manualBookingPrivateTitle(params) {
  return "Phone booking: " + eventTitle(params);
}

function manualBookingPrivateDescription(params, publicEventId, config) {
  return [
    "Phone booking details",
    "Public booked event ID: " + publicEventId,
    "Added: " + new Date().toISOString(),
    "",
    "Customer:",
    "Name: " + (params.name || "Not provided"),
    "Email: " + (params.email || "Not provided"),
    "Phone: " + (params.phone || "Not provided"),
    "",
    "Event:",
    "Date: " + formatDateOnly(parseDateOnly(params.date), config.timeZone),
    "Start time: " + (params.event_time || "Not provided"),
    "Duration: " + formatDuration(params.duration),
    "Event type: " + (params.event_type || "Not provided"),
    "Guest count: " + (params.guests || "Not provided"),
    "Cross streets: " + (params.location || "Not provided"),
    "",
    "Notes:",
    params.message || "Not provided",
  ].join("\n");
}

function manualBookingEmailBody(
  params,
  start,
  end,
  config,
  publicEvent,
  detailsEvent
) {
  const when =
    Utilities.formatDate(start, config.timeZone, "EEEE, MMMM d, yyyy h:mm a") +
    " - " +
    Utilities.formatDate(end, config.timeZone, "h:mm a");
  const detailsCalendarLine = detailsEvent
    ? "\nPrivate details event ID: " + detailsEvent.getId()
    : "\nPrivate details event: Not configured";

  return (
    "A phone booking was added.\n\n" +
    "Public website calendar: all-day Booked block created\n" +
    "Public event ID: " +
    publicEvent.getId() +
    detailsCalendarLine +
    "\n\n" +
    "When: " +
    when +
    "\nDuration: " +
    formatDuration(params.duration) +
    "\nEvent type: " +
    (params.event_type || "Not provided") +
    "\nGuest count: " +
    (params.guests || "Not provided") +
    "\nCross streets: " +
    (params.location || "Not provided") +
    "\n\nCustomer:\nName: " +
    (params.name || "Not provided") +
    "\nEmail: " +
    (params.email || "Not provided") +
    "\nPhone: " +
    (params.phone || "Not provided") +
    "\n\nNotes:\n" +
    (params.message || "Not provided")
  );
}

function formatDuration(value) {
  const minutes = Number(value);

  if (Number.isNaN(minutes) || minutes <= 0) {
    return "Not provided";
  }

  if (minutes % 60 === 0) {
    return minutes / 60 + " hour" + (minutes === 60 ? "" : "s");
  }

  return minutes / 60 + " hours";
}

function submissionSummary(pending, config) {
  const params = pending.params;
  const start = new Date(pending.startIso);
  const end = new Date(pending.endIso);
  const when =
    Utilities.formatDate(start, config.timeZone, "EEEE, MMMM d, yyyy h:mm a") +
    " - " +
    Utilities.formatDate(end, config.timeZone, "h:mm a");

  return (
    eventDescription(params, pending) +
    "\nWhen: " +
    when +
    "\nCurrent calendar conflicts on this date: " +
    pending.conflictCount
  );
}

function actionUrl(action, token, config) {
  const baseUrl = config.webAppUrl || ScriptApp.getService().getUrl();

  if (!baseUrl) {
    throw new Error("Missing Apps Script property: WEB_APP_URL");
  }

  const separator = baseUrl.indexOf("?") === -1 ? "?" : "&";

  return (
    baseUrl +
    separator +
    "action=" +
    encodeURIComponent(action) +
    "&token=" +
    encodeURIComponent(token)
  );
}

function sendManualReviewNotifications(pending, config) {
  const params = pending.params;
  const confirmUrl = actionUrl("confirm", pending.token, config);
  const declineUrl = actionUrl("decline", pending.token, config);

  MailApp.sendEmail({
    to: config.notifyEmail,
    replyTo: params.email,
    subject: "Confirm booking request: " + eventTitle(params),
    body:
      submissionSummary(pending, config) +
      "\n\nThe calendar will not be updated until you confirm this request." +
      "\n\nConfirm and add pending calendar hold:\n" +
      confirmUrl +
      "\n\nDecline without creating a calendar hold:\n" +
      declineUrl,
  });

  MailApp.sendEmail({
    to: params.email,
    subject: "Frannie the Clown booking request received",
    body:
      "Thanks for reaching out to Frannie the Clown!\n\n" +
      "Your booking request was received and is waiting for Frannie's review. " +
      "No calendar hold has been created yet.\n\n" +
      "Frannie will confirm details and send a quote within 24 hours.",
  });
}

function sendConfirmedNotifications(pending, config, eventId) {
  const params = pending.params;
  const when =
    Utilities.formatDate(
      new Date(pending.startIso),
      config.timeZone,
      "EEEE, MMMM d, yyyy h:mm a"
    ) +
    " - " +
    Utilities.formatDate(new Date(pending.endIso), config.timeZone, "h:mm a");

  MailApp.sendEmail({
    to: config.notifyEmail,
    replyTo: params.email,
    subject: "Date marked booked: " + eventTitle(params),
    body:
      eventDescription(params, pending) +
      "\n\nWhen: " +
      when +
      "\nCalendar event ID: " +
      eventId,
  });

  MailApp.sendEmail({
    to: params.email,
    subject: "Frannie the Clown booking request confirmed",
    body:
      "Thanks for reaching out to Frannie the Clown!\n\n" +
      "Frannie has marked your requested date as booked:\n" +
      when +
      "\n\nFrannie will confirm details and send a quote within 24 hours.",
  });
}

function sendDeclinedNotifications(pending, config) {
  const params = pending.params;

  MailApp.sendEmail({
    to: config.notifyEmail,
    replyTo: params.email,
    subject: "Booking request declined: " + eventTitle(params),
    body:
      submissionSummary(pending, config) +
      "\n\nNo calendar hold was created.",
  });

  MailApp.sendEmail({
    to: params.email,
    subject: "Frannie the Clown booking request update",
    body:
      "Thanks for reaching out to Frannie the Clown.\n\n" +
      "Frannie is not able to place a calendar hold for the requested time. " +
      "Please reply with another date or time and Frannie will help find an option that works.",
  });
}

function renderResult(title, message) {
  const html =
    "<!doctype html>" +
    '<html lang="en">' +
    "<head>" +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    "<title>" + escapeHtml(title) + "</title>" +
    "<style>" +
    "body{font-family:Arial,sans-serif;background:#fdf8f0;color:#1a2240;margin:0;padding:2rem;line-height:1.5}" +
    "main{max-width:640px;margin:10vh auto;background:white;border:3px solid #1a2240;border-radius:14px;box-shadow:4px 4px 0 #1a2240;padding:2rem}" +
    "h1{margin-top:0;color:#1a2240}" +
    "a{color:#1a2240;font-weight:700}" +
    "</style>" +
    "</head>" +
    "<body><main>" +
    "<h1>" + escapeHtml(title) + "</h1>" +
    "<p>" + escapeHtml(message) + "</p>" +
    '<p><a href="javascript:history.back()">Back to booking form</a></p>' +
    "</main></body></html>";

  return HtmlService.createHtmlOutput(html)
    .setTitle(title)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function renderManualBookingForm(config, manualKey) {
  const actionUrl = config.webAppUrl || ScriptApp.getService().getUrl();
  const today = formatDateOnly(startOfDay(new Date()), config.timeZone);
  const html =
    "<!doctype html>" +
    '<html lang="en">' +
    "<head>" +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    "<title>Add Phone Booking</title>" +
    "<style>" +
    "body{font-family:Arial,sans-serif;background:#fdf8f0;color:#1a2240;margin:0;padding:1.25rem;line-height:1.5}" +
    "main{max-width:720px;margin:4vh auto;background:white;border:3px solid #1a2240;border-radius:14px;box-shadow:4px 4px 0 #1a2240;padding:1.5rem}" +
    "h1{margin-top:0;color:#1a2240}" +
    ".grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.8rem}" +
    ".full{grid-column:1/-1}" +
    "label{display:block;font-weight:700;margin:.9rem 0 .35rem}" +
    "input,select,textarea,button{width:100%;min-height:46px;border:2px solid #1a2240;border-radius:8px;font:inherit;padding:.65rem}" +
    "textarea{min-height:120px;resize:vertical}" +
    "button{margin-top:1rem;background:#f9c846;color:#1a2240;font-weight:700;cursor:pointer;box-shadow:3px 3px 0 #1a2240}" +
    "p{color:rgba(26,34,64,.72)}" +
    "@media(max-width:640px){.grid{grid-template-columns:1fr}}" +
    "</style>" +
    "</head>" +
    "<body><main>" +
    "<h1>Add Phone Booking</h1>" +
    "<p>Use this after a phone call. It creates a public all-day Booked block for the website calendar and emails Frannie the call details.</p>" +
    '<form method="post" action="' +
    escapeHtml(actionUrl) +
    '">' +
    '<input type="hidden" name="action" value="add_manual">' +
    '<input type="hidden" name="manual_key" value="' +
    escapeHtml(manualKey) +
    '">' +
    '<div class="grid">' +
    '<label for="date">Booking date</label>' +
    '<input id="date" name="date" type="date" min="' +
    escapeHtml(today) +
    '" required>' +
    '<label for="event_time">Start time</label>' +
    '<input id="event_time" name="event_time" type="time" step="900" required>' +
    '<label for="duration">Duration</label>' +
    '<select id="duration" name="duration" required>' +
    '<option value="120" selected>2 hours</option>' +
    '<option value="150">2.5 hours</option>' +
    '<option value="180">3 hours</option>' +
    '<option value="210">3.5 hours</option>' +
    '<option value="240">4 hours</option>' +
    '<option value="270">4.5 hours</option>' +
    '<option value="300">5 hours</option>' +
    "</select>" +
    '<label for="event_type">Event type</label>' +
    '<select id="event_type" name="event_type">' +
    '<option value="">Not provided</option>' +
    "<option>Birthday Party</option>" +
    "<option>Holiday Event</option>" +
    "<option>Team Celebration</option>" +
    "<option>Festival / Fair</option>" +
    "<option>Other</option>" +
    "</select>" +
    '<label for="name">Customer name</label>' +
    '<input id="name" name="name" type="text" autocomplete="name">' +
    '<label for="phone">Phone</label>' +
    '<input id="phone" name="phone" type="tel" autocomplete="tel">' +
    '<label for="email">Email</label>' +
    '<input id="email" name="email" type="email" autocomplete="email">' +
    '<label for="guests">Approximate guest count</label>' +
    '<input id="guests" name="guests" type="number" min="1">' +
    '<label class="full" for="location">Event cross streets</label>' +
    '<input class="full" id="location" name="location" type="text" placeholder="e.g. Adams Ave & 30th St">' +
    '<label class="full" for="message">Call notes</label>' +
    '<textarea class="full" id="message" name="message" placeholder="Package, quote, special requests, parking, costume notes, follow-up needed"></textarea>' +
    "</div>" +
    "<button type=\"submit\">Mark Date Booked</button>" +
    "</form>" +
    "</main></body></html>";

  return HtmlService.createHtmlOutput(html)
    .setTitle("Add Phone Booking")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
