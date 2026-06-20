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
Formspark booking form. Formspark keeps the booking inbox and forwards each
submission to Apps Script as JSON. Apps Script emails Frannie secure confirm and
decline links, then creates a gray all-day `Booked` calendar event only after
Frannie clicks the confirm link. The customer receives an automatic receipt
first, then a confirmation email after the calendar block is created.

Formspark webhooks send submitted form fields as a top-level JSON object, so the
field names in `index.html` are the contract with Apps Script. Required fields
are `name`, `email`, `date`, `event_time`, `duration`, and `location`; the
visible form asks for event cross streets while keeping the `location` field name
for webhook compatibility. Optional fields currently used in emails are `phone`,
`event_type`, `guests`, and `message`.

To avoid exposing customer PII on the embedded public calendar, calendar events
use the generic title `Booked`, a broad San Diego location, and a short
non-sensitive description. Customer name, email, phone, exact event location,
and message stay in Formspark and in Frannie's approval emails.

The approval token stored in Apps Script is also minimized. Until a request is
confirmed, declined, or cleaned up, Apps Script stores the date/time, customer
email, event type, and guest count. The full message, phone number, customer
name, and exact location are not stored in the pending token record.

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

## Content assets

The About Frannie page has a video-first hero wired for a short clip at
`assets/frannie-about-hero.mp4`. Until that file exists, the video element uses
`assets/frannie-veteran.jpg` as its poster image.

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
FRANNIE_APPS_SCRIPT_WEB_APP_URL
```

These are repository variables, not secrets. The deployed browser receives them
inside `site-config.js`.

Optional repository variable:

```text
FRANNIE_BOTPOISON_PUBLIC_KEY
```

This is safe to expose in the browser. Keep the Botpoison secret key only in
Formspark's spam protection settings.

Do not add Apps Script-only private values to the Pages workflow. Set those
directly in Apps Script Script Properties and Formspark settings:

```text
BOOKING_CALENDAR_ID
BLOCKING_CALENDAR_IDS
NOTIFY_EMAIL
TIME_ZONE
WEB_APP_URL
MANUAL_BOOKING_KEY
WEBHOOK_SECRET
```

`WEBHOOK_SECRET` is the shared password between Formspark and Apps Script. It is
not generated into `site-config.js` and should not be added to GitHub Pages
variables. Store it as `WEBHOOK_SECRET` in Apps Script, then append it to the
Formspark Webhook URL as `?booking_key=...`.

The embedded website calendar and Apps Script `BOOKING_CALENDAR_ID` should point
to the same dedicated public booking calendar. That keeps the public site limited
to:

- booking holds created after Frannie approves a form request
- bookings manually added by Frannie to the booking calendar

The public iCal feed generated from that calendar ID is safe to share for
read-only subscriptions. Do not publish a private iCal feed, because it contains
a private subscription token.

For the strongest privacy, set the public calendar sharing level to "See only
free/busy". If you want visitors to see the word `Booked`, use "See all event
details"; the code avoids writing customer PII into calendar title, location,
or description either way.

If private calendars should block conflicts without appearing on the website,
add those calendar IDs to `FRANNIE_APPS_SCRIPT_BLOCKING_CALENDAR_IDS` in `.env`
and to `BLOCKING_CALENDAR_IDS` in Apps Script Script Properties.
The website date picker still reads booked dates only from `BOOKING_CALENDAR_ID`,
so private conflicts do not appear as gray dates on the public form.
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
   `BLOCKING_CALENDAR_IDS`, optional `WEB_APP_URL`, optional
   `MANUAL_BOOKING_KEY`, and optional `WEBHOOK_SECRET`.
7. Deploy the script as a Web App.
8. Set "Execute as" to yourself.
9. Set access to "Anyone".
10. Copy the Web App `/exec` URL.
11. Save that URL as `FRANNIE_APPS_SCRIPT_WEB_APP_URL` in `.env` and as the
   matching GitHub Pages repository variable. The website uses it to load
   unavailable booking dates before the form can submit.
12. In Formspark, open the booking form settings.
13. Set the Webhook URL to the Apps Script `/exec` URL. Also add the same URL as
   the Apps Script `WEB_APP_URL` property if confirmation links do not
   appear correctly in email.
14. Set Custom honeypot to `website`.
15. To protect the submission quota more strongly, enable Botpoison in
    Formspark's Spam Protection settings. Put the Botpoison public key in
    `FRANNIE_BOTPOISON_PUBLIC_KEY` and the Botpoison secret key in Formspark
    only.

Formspark keeps the booking inbox, then forwards each submission to Apps Script
so it can email Frannie for manual approval.

Quota protection:

- Formspark should reject spam before saving a submission, sending
  notifications, decrementing the submission counter, or calling the webhook.
- The form includes both the custom `website` honeypot and the default
  `_gotcha` honeypot field.
- Apps Script still checks honeypot fields as a fallback, but that fallback runs
  after Formspark receives the submission, so it is not enough by itself to
  protect a Formspark monthly limit.

Optional webhook secret:

1. Set `WEBHOOK_SECRET` as an Apps Script Script Property.
2. Add the same value to the Formspark Webhook URL as a query parameter:

```text
https://script.google.com/macros/s/deployment-id/exec?booking_key=private-secret
```

If `WEBHOOK_SECRET` is set in Apps Script, any webhook call without the matching
`booking_key` query parameter is rejected before the booking request is stored
or emailed for approval.

Optional phone-booking helper:

1. Set `MANUAL_BOOKING_KEY` as an Apps Script Script Property.
2. Bookmark this private URL on Frannie's phone:

```text
https://script.google.com/macros/s/deployment-id/exec?action=manual&manual_key=private-secret
```

After a phone call, Frannie can open that URL, pick the booking date, choose an
optional event type, and mark the date as `Booked` on the public booking
calendar. The helper deliberately does not store customer name, phone number,
location, or message on the public calendar.

After setup, submit a test booking. Frannie should receive an email with confirm
and decline links. The calendar should stay unchanged until the confirm link is
clicked. After confirmation, submit another test request anywhere on the same
date; the new confirmation link should refuse to create a duplicate block
because the full day is already booked.

Troubleshooting:

- Open the Apps Script `/exec` URL in a private browser window. It should say
  the booking webhook is live.
- In the Apps Script editor, run `testCalendarWrite`. If it fails, the deployed
  script owner does not have write permission to the booking calendar, or the
  calendar ID is wrong. Public sharing lets visitors view the calendar, but it
  does not grant Apps Script write access.
- If `testCalendarWrite` succeeds but Frannie does not receive approval emails,
  Formspark is not forwarding submissions to Apps Script. Confirm the Webhook
  URL points at the current Apps Script `/exec` URL.
- If approval emails arrive but their confirm links fail, set `WEB_APP_URL` in
  Apps Script Script Properties to the current `/exec` deployment URL.
- If confirmed events appear in Google Calendar but not on the website, open the
  deployed `site-config.js` and verify `PUBLIC_CALENDAR_ID` matches
  `BOOKING_CALENDAR_ID`. Hidden whitespace in GitHub repository variables can
  make the embed load the wrong calendar ID; `make config` trims values when it
  generates the browser config.
- After editing `google-calendar-booking.gs`, create a new Apps Script
  deployment version or update the existing deployment. Saving the file alone
  does not update the live `/exec` URL.
