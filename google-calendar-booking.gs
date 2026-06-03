// Use a dedicated public calendar for the website, for example
// "Frannie Bookings". The site embeds this same calendar, and this script
// writes pending booking holds to it.
const BOOKING_CALENDAR_ID =
  "2f3d268e5a59bb163f7f79bfdf4a8c8d54d4305cc8c8a28295bcd7906baae8fd@group.calendar.google.com";

// Optional: add private calendars here to reject conflicts without showing
// those private events on the public website.
const BLOCKING_CALENDAR_IDS = [
  BOOKING_CALENDAR_ID,
];

const NOTIFY_EMAIL = "frannietheclown1@gmail.com";
const TIME_ZONE = "America/Los_Angeles";

function doPost(e) {
  const params = extractSubmission(e);

  if (params._gotcha) {
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

  const bookingCalendar = CalendarApp.getCalendarById(BOOKING_CALENDAR_ID);
  if (!bookingCalendar) {
    return renderResult(
      "Calendar unavailable",
      "Frannie's calendar could not be reached. Please call or email to book."
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

  const conflicts = getConflicts(start, end);
  if (conflicts.length) {
    return renderResult(
      "That time is already booked",
      "Please go back and choose another date or time, or call Frannie to check alternatives."
    );
  }

  const event = bookingCalendar.createEvent(
    "PENDING: " + eventTitle(params),
    start,
    end,
    {
      location: params.location,
      description: eventDescription(params),
    }
  );
  event.setColor(CalendarApp.EventColor.YELLOW);

  sendNotifications(params, start, end);

  return renderResult(
    "Request received",
    "Your date is being held as pending. Frannie will confirm details and send a quote within 24 hours."
  );
}

function extractSubmission(e) {
  const params = Object.assign({}, e && e.parameter ? e.parameter : {});
  const payload = parseJsonPostData(e);

  // Formspree Simple Webhooks send form fields under payload.submission.
  if (
    payload &&
    payload.submission &&
    typeof payload.submission === "object"
  ) {
    return Object.assign(params, payload.submission);
  }

  if (payload && typeof payload === "object") {
    return Object.assign(params, payload);
  }

  return params;
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

function getConflicts(start, end) {
  return BLOCKING_CALENDAR_IDS.flatMap((calendarId) => {
    const calendar = CalendarApp.getCalendarById(calendarId);
    return calendar ? calendar.getEvents(start, end) : [];
  });
}

function buildDate(date, time) {
  const parts = date.split("-").map(Number);
  const timeParts = time.split(":").map(Number);

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
  return eventType + " for " + params.name;
}

function eventDescription(params) {
  return [
    "Booking request from the website",
    "",
    "Name: " + params.name,
    "Email: " + params.email,
    "Phone: " + (params.phone || "Not provided"),
    "Event type: " + (params.event_type || "Not provided"),
    "Guest count: " + (params.guests || "Not provided"),
    "Location: " + params.location,
    "",
    "Message:",
    params.message || "No message provided",
  ].join("\n");
}

function sendNotifications(params, start, end) {
  const when =
    Utilities.formatDate(start, TIME_ZONE, "EEEE, MMMM d, yyyy h:mm a") +
    " - " +
    Utilities.formatDate(end, TIME_ZONE, "h:mm a");

  MailApp.sendEmail({
    to: NOTIFY_EMAIL,
    replyTo: params.email,
    subject: "New pending booking: " + eventTitle(params),
    body: eventDescription(params) + "\n\nWhen: " + when,
  });

  MailApp.sendEmail({
    to: params.email,
    subject: "Frannie the Clown booking request received",
    body:
      "Thanks for reaching out to Frannie the Clown!\n\n" +
      "Your requested time is being held as pending:\n" +
      when +
      "\n\nFrannie will confirm details and send a quote within 24 hours.",
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
