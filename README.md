# FrannieWebsite
Website for Frannie the Clown

## Local development

Create local website config:

```sh
cp .env.example .env
make config
```

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

## Configuration

Website and booking configuration is kept in `.env`, which is ignored by git.
Use `.env.example` as the template.

Browser-facing values are generated into `site-config.js`:

```sh
make config
```

`site-config.js` is also ignored by git. These values are not true secrets once
the site is deployed because the browser needs them to render the form, links,
and public calendar. Keeping them out of `index.html` still makes account swaps
and testing much cleaner.

## GitHub Pages deployment

The workflow in `.github/workflows/deploy-pages.yml` deploys the static site
whenever `master` is pushed. It generates `site-config.js` during the GitHub
Actions run from repository variables, then uploads only the public site files.

In GitHub, go to Settings > Pages and set Source to "GitHub Actions".

Then go to Settings > Secrets and variables > Actions > Variables, and add:

```text
FRANNIE_FORMSPARK_FORM_URL
FRANNIE_PUBLIC_CALENDAR_ID
FRANNIE_TIME_ZONE
FRANNIE_CONTACT_EMAIL
FRANNIE_CONTACT_PHONE_DISPLAY
FRANNIE_CONTACT_PHONE_TEL
FRANNIE_FACEBOOK_URL
FRANNIE_YELP_URL
```

These are repository variables, not secrets. The deployed browser receives them
inside `site-config.js`.

Do not add Apps Script-only values to the Pages workflow. Set those directly in
Apps Script Script Properties and Formspark settings:

```text
BOOKING_CALENDAR_ID
BLOCKING_CALENDAR_IDS
NOTIFY_EMAIL
TIME_ZONE
WEBHOOK_SECRET
```

The embedded website calendar and Apps Script `BOOKING_CALENDAR_ID` should point
to the same dedicated public booking calendar. That keeps the public site limited
to:

- booking holds created through the form
- bookings manually added by Frannie to the booking calendar

The public iCal feed generated from that calendar ID is safe to share for
read-only subscriptions. Do not publish a private iCal feed, because it contains
a private subscription token.

If private calendars should block conflicts without appearing on the website,
add those calendar IDs to `FRANNIE_APPS_SCRIPT_BLOCKING_CALENDAR_IDS` in `.env`
and to `BLOCKING_CALENDAR_IDS` in Apps Script Script Properties.
If the public booking calendar is the only calendar that should block requests,
set `FRANNIE_APPS_SCRIPT_BLOCKING_CALENDAR_IDS` to the same value as
`FRANNIE_APPS_SCRIPT_BOOKING_CALENDAR_ID`.

Current testing and final production account values should live in `.env` and in
the matching Formspark / Apps Script account settings, not in committed HTML.
Final production setup should create a new public calendar, Formspark form, Apps
Script deployment, and notification settings for Frannie's booking inbox.

Setup:

1. In Google Calendar settings for the calendar above, enable "Make available to
   public". Use "See all event details" if event titles should show, or "See
   only free/busy" if the public site should only show blocked times.
2. Copy `.env.example` to `.env` and fill in the current account-specific values.
3. Run `make config` to generate `site-config.js`.
4. Create a Google Apps Script project while signed in as the calendar owner.
5. Paste in the contents of `google-calendar-booking.gs`.
6. In Apps Script Project Settings, add Script Properties:
   `BOOKING_CALENDAR_ID`, `NOTIFY_EMAIL`, `TIME_ZONE`, optional
   `BLOCKING_CALENDAR_IDS`, and optional `WEBHOOK_SECRET`.
7. Deploy the script as a Web App.
8. Set "Execute as" to yourself.
9. Set access to "Anyone".
10. Copy the Web App `/exec` URL.
11. In Formspark, open the booking form settings.
12. Set the Webhook URL to the Apps Script `/exec` URL. You can keep that URL in
   `.env` as `FRANNIE_APPS_SCRIPT_WEB_APP_URL` for reference.
13. Set Custom honeypot to `website`.

Formspark keeps the booking inbox, then forwards each submission to Apps Script
so it can create the calendar hold.

Optional webhook secret:

1. Set `WEBHOOK_SECRET` as an Apps Script Script Property.
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
