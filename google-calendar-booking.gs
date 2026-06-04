// Configure these values in Apps Script Project Settings > Script Properties.
// Required: BOOKING_CALENDAR_ID, NOTIFY_EMAIL.
// Optional: BLOCKING_CALENDAR_IDS, TIME_ZONE, WEBHOOK_SECRET, WEB_APP_URL.
const DEFAULT_TIME_ZONE = "America/Los_Angeles";
const PENDING_BOOKING_PREFIX = "PENDING_BOOKING_";
const PENDING_BOOKING_TTL_DAYS = 45;

function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};

  if (params.action === "confirm") {
    return handleBookingConfirmation(params.token);
  }

  if (params.action === "decline") {
    return handleBookingDecline(params.token);
  }

  return renderResult(
    "Booking webhook is live",
    "This Google Apps Script deployment is reachable. Submit the booking form, then use the emailed confirmation link to create a calendar hold."
  );
}

function doPost(e) {
  try {
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
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(9, 0, 0, 0);

  const end = new Date(start.getTime() + 15 * 60 * 1000);
  const calendar = CalendarApp.getCalendarById(config.bookingCalendarId);

  if (!calendar) {
    throw new Error("Calendar not found: " + config.bookingCalendarId);
  }

  const event = calendar.createEvent(
    "TEST: Website booking calendar write",
    start,
    end,
    {
      description:
        "Delete this event after confirming the website booking calendar can be written by Apps Script.",
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
  const durationMinutes = Number(params.duration);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);

  if (
    !isValidDate(start) ||
    Number.isNaN(durationMinutes) ||
    durationMinutes <= 0
  ) {
    return renderResult(
      "Invalid time",
      "Please go back and choose a valid event date, start time, and duration."
    );
  }

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

    const bookingDay = startOfDay(start);
    const conflicts = getConflicts(
      bookingDay,
      startOfNextDay(start),
      config.blockingCalendarIds
    );

    if (conflicts.length) {
      return renderResult(
        "Date already booked",
        "The calendar has a conflict on this date. No public booked block was created."
      );
    }

    const params = pending.params;
    const event = bookingCalendar.createAllDayEvent(
      calendarEventTitle(params),
      bookingDay,
      {
        location: "San Diego, CA",
        description: calendarEventDescription(params, pending),
      }
    );
    event.setColor(CalendarApp.EventColor.GRAY);
    deletePendingBooking(token);
    sendConfirmedNotifications(pending, config, event.getId());

    return renderResult(
      "Date marked booked",
      "This booking date is now marked as booked on Frannie's public calendar."
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
    webAppUrl: getOptionalScriptProperty("WEB_APP_URL"),
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

function isAuthorizedWebhook(e, config) {
  if (!config.webhookSecret) {
    return true;
  }

  const params = e && e.parameter ? e.parameter : {};
  return params.booking_key === config.webhookSecret;
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

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfNextDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
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
    email: params.email,
    event_type: params.event_type,
    guests: params.guests,
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
    "Location: " + (params.location || "Not stored after initial approval email"),
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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
