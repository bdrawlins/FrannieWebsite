# FrannieWebsite
Website for Frannie the Clown

## Local development

Start a local preview server:

```sh
make serve
```

Then open http://localhost:8000.

Use a different port when needed:

```sh
make serve PORT=8002
```

Check the site before pushing:

```sh
make check
```

See or stop local preview servers on ports 8000-8002:

```sh
make ports
make stop-local
```

## Mobile smoke check

Before pushing, preview these viewport widths in the browser dev tools:

- 390px wide for common phones
- 768px wide for tablets
- 1280px wide for desktop

Confirm the navigation is reachable, the hero buttons stack cleanly, the
booking form is one column on mobile, and gallery images remain square.

## Automatic booking sync

The file `google-calendar-booking.gs` is a Google Apps Script webhook for the
Formspree booking form. It checks Frannie's booking calendar for conflicts,
creates a yellow pending calendar event when the slot is open, and emails both
Frannie and the customer.

The public website calendar is:

```text
2f3d268e5a59bb163f7f79bfdf4a8c8d54d4305cc8c8a28295bcd7906baae8fd@group.calendar.google.com
```

The embedded calendar and Apps Script `BOOKING_CALENDAR_ID` should point to this
same calendar. That keeps the public site limited to:

- booking holds created through the form
- bookings manually added by Frannie to the booking calendar

The public iCal feed is safe to share for read-only subscriptions:

```text
https://calendar.google.com/calendar/ical/2f3d268e5a59bb163f7f79bfdf4a8c8d54d4305cc8c8a28295bcd7906baae8fd%40group.calendar.google.com/public/basic.ics
```

Do not publish the private iCal feed in `index.html`, because it contains a
private subscription token.

If Frannie wants private calendars to block conflicts without appearing on the
site, add those calendar IDs to `BLOCKING_CALENDAR_IDS` in
`google-calendar-booking.gs`.

Setup:

1. Confirm the Google Calendar above is public or shareable enough for the
   website embed.
2. Create a Google Apps Script project while signed in as the calendar owner.
3. Paste in the contents of `google-calendar-booking.gs`.
4. Deploy the script as a Web App.
5. Set "Execute as" to yourself.
6. Set access to "Anyone".
7. Copy the Web App `/exec` URL.
8. In Formspree, add a Simple Webhook for the booking form and use the Apps
   Script `/exec` URL as the webhook target.

Leave the `index.html` form action pointed at Formspree. Formspree keeps the
booking inbox, then forwards each submission to Apps Script so it can create the
calendar hold.

After setup, submit the same date and time twice. The first request should
create a pending event; the second request should be rejected as already booked.
