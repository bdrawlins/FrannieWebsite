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
Formspark booking form. It checks Frannie's booking calendar for conflicts,
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

1. In Google Calendar settings for the calendar above, enable "Make available to
   public". Use "See all event details" if event titles should show, or "See
   only free/busy" if the public site should only show blocked times.
2. Create a Google Apps Script project while signed in as the calendar owner.
3. Paste in the contents of `google-calendar-booking.gs`.
4. Deploy the script as a Web App.
5. Set "Execute as" to yourself.
6. Set access to "Anyone".
7. Copy the Web App `/exec` URL.
8. In Formspark, open the "Frannie the Clown Bookings" form settings.
9. Set the Webhook URL to the Apps Script `/exec` URL.
10. Set Custom honeypot to `website`.

Current Apps Script Web App URL:

```text
https://script.google.com/macros/s/AKfycbxy0Ckw1fTnm0P7Y3r5s_ruJWPyeollNYsEn1x8IiDLdGn6IBWwFyvmF6I438qiZg5cfg/exec
```

Leave the `index.html` form action pointed at Formspark:

```text
https://submit-form.com/A0GcLLdM2
```

Formspark keeps the booking inbox, then forwards each submission to Apps Script
so it can create the calendar hold.

Optional webhook secret:

1. Set `WEBHOOK_SECRET` in `google-calendar-booking.gs` to a private string.
2. Add it to the Formspark Webhook URL as a query parameter:

```text
https://script.google.com/macros/s/deployment-id/exec?booking_key=private-secret
```

After setup, submit the same date and time twice. The first request should
create a pending event; the second request should be rejected as already booked.

Troubleshooting:

- Open the Apps Script `/exec` URL in a private browser window. It should say
  the booking webhook is live.
- In the Apps Script editor, run `testCalendarWrite`. If it fails, the deployed
  script owner does not have write permission to the booking calendar, or the
  calendar ID is wrong. Public sharing lets visitors view the calendar, but it
  does not grant Apps Script write access.
- If `testCalendarWrite` succeeds but form submissions do not create events,
  Formspark is not forwarding submissions to Apps Script. Confirm the Webhook
  URL points at the current Apps Script `/exec` URL.
- After editing `google-calendar-booking.gs`, create a new Apps Script
  deployment version or update the existing deployment. Saving the file alone
  does not update the live `/exec` URL.
