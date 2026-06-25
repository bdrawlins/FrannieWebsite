# FrannieWebsite

Static website for Frannie the Clown, deployed through GitHub Pages.

The site is mostly static HTML/CSS with a small generated browser config file.
Booking requests go through Formspark, then a Google Apps Script webhook emails
Frannie for manual approval before writing a public all-day `Booked` event to
Google Calendar.

## Quick Start

Create local browser config:

```sh
cp .env.example .env
make config
```

Start a local preview server:

```sh
make serve
```

Open http://localhost:8000.

Use another port if needed:

```sh
make serve PORT=8002
```

Run the repo check before pushing:

```sh
make check
```

See or stop local preview servers on ports 8000-8002:

```sh
make ports
make stop-local
```

## Project Map

- `index.html`: main page, booking form, calendar embed, Yelp review excerpts,
  gallery, and browser scripts.
- `about.html`: standalone About Frannie page with an image-first hero.
- `index.css`: shared styles for both pages.
- `CNAME`, `robots.txt`, `sitemap.xml`: custom-domain and search discovery
  files deployed at the site root.
- `assets/`: images and favicon.
- `scripts/build_site_config.py`: generates browser-facing `site-config.js`
  from environment variables.
- `scripts/check_seo.py`: local crawl/metadata/schema smoke check used by
  `make check`.
- `google-calendar-booking.gs`: Google Apps Script webhook and manual booking
  helper.
- `.github/workflows/deploy-pages.yml`: GitHub Pages deployment.
- `.env.example`: template for local and deployment settings.

`site-config.js` and `.env` are intentionally gitignored.

## Editing Content

### Main Page

Most public copy lives in `index.html`. The home page side navigation links to
the main sections: Services, Area, Availability, Book, FAQ, Reviews, and
Gallery. The top navigation keeps About as the standalone second page.

The public Google Calendar embed is intentionally a single monthly view. The
booking date picker below it is separate from the embed and uses Apps Script to
load unavailable dates.

### About Page

`about.html` stands alone and links back to the main page. Its hero uses:

```text
assets/frannie-veteran.jpg
```

### Yelp Reviews

The Yelp section uses manually curated raw excerpts in `index.html`. It is not
synced to Yelp automatically. The review cards pan with left and right buttons,
and long review text scrolls vertically inside each card.

Do not put a Yelp API key in browser JavaScript or `site-config.js`.

### Gallery Images

Gallery and customer photos live in `assets/`. After adding or replacing files,
update the matching `<img>` tags in `index.html` and run `make check`.

## Smoke Check

Before pushing, preview these viewport widths in browser dev tools:

- 390px wide for common phones
- 768px wide for tablets
- 1280px wide for desktop

Confirm:

- top navigation and home side navigation are reachable
- hero buttons stack cleanly
- booking form is one column on mobile
- monthly calendar remains usable
- review pan buttons work
- long review text scrolls inside each card
- gallery images remain square
- About page hero image is framed correctly

## SEO Preflight

`make check` runs `scripts/check_seo.py` before the placeholder scan. It verifies:

- canonical URLs, Open Graph URLs, and social image URLs
- parseable JSON-LD on both public pages
- `CNAME`, `robots.txt`, and `sitemap.xml`
- sitemap URLs for the home and About pages
- local asset references and internal anchor targets

## Deployment

The workflow in `.github/workflows/deploy-pages.yml` deploys the static site
whenever `master` is pushed. It generates `site-config.js` from GitHub
repository variables, then uploads the public site files, including the custom
domain and search discovery files at the site root.

GitHub Pages should be set to use GitHub Actions:

```text
Settings > Pages > Source > GitHub Actions
```

Before pushing:

```sh
make check
git status --short
```

After deployment, if the live site looks stale or points at the wrong calendar,
inspect the deployed `site-config.js` first. The live browser config is the
source of truth for what the page is actually using.

## Configuration Model

There are two separate config planes. Keep them separate.

### Browser Config

Browser-facing values are generated into `site-config.js`.

Local development reads these from `.env`:

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
FRANNIE_BOTPOISON_PUBLIC_KEY
```

Production reads the same names from GitHub repository variables:

```text
Settings > Secrets and variables > Actions > Variables
```

These values are not true secrets once deployed because the browser receives
them. `FRANNIE_BOTPOISON_PUBLIC_KEY` is safe to expose; the Botpoison secret key
must stay inside Formspark settings.

### Apps Script Properties

Private webhook and calendar-write settings belong in Apps Script Script
Properties, not in `site-config.js` and not in GitHub Pages variables:

```text
BOOKING_CALENDAR_ID
BLOCKING_CALENDAR_IDS
NOTIFY_EMAIL
TIME_ZONE
WEB_APP_URL
MANUAL_BOOKING_KEY
PRIVATE_BOOKING_DETAILS_CALENDAR_ID
WEBHOOK_SECRET
```

Script Properties are runtime configuration. Changing them does not require a
new Apps Script deployment version. Editing `google-calendar-booking.gs` does
require a new deployment version or updating the existing deployment.

`PRIVATE_BOOKING_DETAILS_CALENDAR_ID` is optional. Leave it unset unless Frannie
has a separate private calendar for detailed customer information.

## Booking Flow

1. A visitor submits the booking form.
2. Formspark stores the submission and sends its normal receipt/notification.
3. Formspark forwards the submission JSON to Apps Script.
4. Apps Script checks for spam fields, required fields, authorization, and date
   conflicts.
5. Apps Script emails Frannie secure confirm and decline links.
6. Nothing is added to Google Calendar until Frannie clicks confirm.
7. On confirm, Apps Script re-checks conflicts and creates a gray all-day
   `Booked` event.
8. Apps Script emails the customer after the calendar block is created.

The form field names are the contract with Apps Script. Required fields:

```text
name
email
date
event_time
duration
location
```

The visible form asks for event cross streets while keeping the field name
`location` for webhook compatibility.

Apps Script enforces a minimum `duration` of 120 minutes even if a malformed
payload bypasses the browser form.

Optional fields currently used in emails:

```text
phone
event_type
guests
message
```

## Calendar Rules

Use a dedicated public booking calendar owned by the Apps Script account.
`FRANNIE_PUBLIC_CALENDAR_ID` and Apps Script `BOOKING_CALENDAR_ID` should point
to that same calendar.

That public calendar should show only:

- booking holds created after Frannie approves a form request
- phone bookings Frannie manually adds to the booking calendar

The public calendar event is privacy-light:

- title: `Booked`
- location: broad San Diego location
- description: non-sensitive booking note

Customer name, phone, exact address, and message stay in Formspark and approval
emails. They should not be written to the public calendar.

Phone bookings follow the same public-calendar rule: the website calendar gets a
privacy-light all-day `Booked` block. The private call details are emailed to
Frannie. If `PRIVATE_BOOKING_DETAILS_CALENDAR_ID` is configured later, the same
helper can also create a detailed private timed event.

If private calendars should block conflicts without appearing on the public
site, add those IDs to Apps Script `BLOCKING_CALENDAR_IDS`. The website date
picker still reads public booked dates only from `BOOKING_CALENDAR_ID`, so
private conflicts do not appear as gray dates on the public form.

For public sharing:

- Use "See all event details" if visitors should see the word `Booked`.
- Use "See only free/busy" for the strongest privacy.
- Do not publish private iCal feeds, because they contain private subscription
  tokens.

## Initial Booking Setup

1. Create or choose a dedicated booking calendar owned by the account that will
   run Apps Script.
2. In Google Calendar settings, make that calendar public at the desired sharing
   level.
3. Copy `.env.example` to `.env` and fill in browser-facing values.
4. Run `make config`.
5. Create a Google Apps Script project while signed in as the calendar owner.
6. Paste in `google-calendar-booking.gs`.
7. Add Apps Script Properties:
   `BOOKING_CALENDAR_ID`, `NOTIFY_EMAIL`, `TIME_ZONE`, optional
   `BLOCKING_CALENDAR_IDS`, optional `WEB_APP_URL`, optional
   `MANUAL_BOOKING_KEY`, optional `PRIVATE_BOOKING_DETAILS_CALENDAR_ID`, and
   optional `WEBHOOK_SECRET`.
8. Deploy the script as a Web App.
9. Set "Execute as" to yourself.
10. Set access to "Anyone".
11. Copy the Web App `/exec` URL. Use the public
    `https://script.google.com/macros/s/.../exec` form, not a browser URL with
    `/macros/u/1/s/.../exec`.
12. Save that URL as `FRANNIE_APPS_SCRIPT_WEB_APP_URL` in `.env` and in GitHub
    repository variables.
13. In Formspark, set the Webhook URL to the Apps Script `/exec` URL.
14. Set Formspark custom honeypot to `website`.
15. Configure Formspark spam protection before relying on Apps Script fallback
    checks.

After any `.gs` code edit, update the deployed Apps Script version. Saving the
file in the Apps Script editor is not enough to update the live `/exec` URL.

## Apps Script Refresh Checklist

Use this checklist after changing `google-calendar-booking.gs`.

1. Open the Apps Script project while signed in as the calendar owner.
2. Paste the full contents of `google-calendar-booking.gs` into the editor.
3. Save the file.
4. In Project Settings, confirm these Script Properties exist:
   `BOOKING_CALENDAR_ID`, `NOTIFY_EMAIL`, `TIME_ZONE`, `WEB_APP_URL`, and any
   optional values in use.
5. Set `MANUAL_BOOKING_KEY` if Frannie will use the private phone-booking form.
6. Leave `PRIVATE_BOOKING_DETAILS_CALENDAR_ID` unset unless a private details
   calendar exists and the Apps Script account can write to it.
7. Deploy a new Web App version, or edit the existing Web App deployment and
   select a new version.
8. Keep "Execute as" set to yourself and access set to "Anyone".
9. Copy the deployed `/exec` URL. Use the public
   `https://script.google.com/macros/s/.../exec` form, not a browser URL with
   `/macros/u/1/s/.../exec`.
10. Update Apps Script `WEB_APP_URL` to that same `/exec` URL.
11. Update `FRANNIE_APPS_SCRIPT_WEB_APP_URL` in GitHub repository variables if
    the deployment URL changed.
12. Confirm Formspark's webhook still points to the current `/exec` URL, with
    `?booking_key=...` if `WEBHOOK_SECRET` is enabled.
13. Open the `/exec` URL in a private browser window. It should say the booking
    webhook is live.
14. In the Apps Script editor, run `testCalendarWrite`. It should create a
    yellow all-day test event on today's date in `TIME_ZONE`; delete that test
    event from Google Calendar after confirming write access.
15. Open the private phone helper URL and create a test booking on a future
    date, then delete the test `Booked` event after confirming the flow.

## Spam and Quota Protection

Formspark quota protection must happen before Formspark accepts a submission.
Apps Script fallback checks run only after Formspark has already received the
submission.

Use all applicable Formspark-side spam controls:

- custom honeypot: `website`
- default `_gotcha` honeypot field from the form
- Botpoison or equivalent spam protection in Formspark

Keep the Botpoison public key in browser config if needed. Keep the Botpoison
secret key only in Formspark.

## Optional Webhook Secret

`WEBHOOK_SECRET` is the shared password between Formspark and Apps Script.

Set it as an Apps Script Script Property:

```text
WEBHOOK_SECRET=private-secret
```

Then append it to the Formspark Webhook URL:

```text
https://script.google.com/macros/s/deployment-id/exec?booking_key=private-secret
```

If `WEBHOOK_SECRET` is set, Apps Script rejects webhook calls without the
matching `booking_key` before storing or emailing the booking request.

Do not generate `WEBHOOK_SECRET` into `site-config.js`.

## Optional Phone-Booking Helper

The Apps Script file includes a private helper for phone bookings.

Set `MANUAL_BOOKING_KEY` as an Apps Script Script Property, then bookmark:

```text
https://script.google.com/macros/s/deployment-id/exec?action=manual&manual_key=private-secret
```

Frannie can open that URL after a phone call, pick a booking date, choose an
event time, duration, event type, guest count, customer contact details, cross
streets, and call notes. Submitting the form marks the date as `Booked` on the
public booking calendar and emails Frannie a formatted summary.

The helper deliberately does not store customer name, phone number, exact
location, or message on the public calendar. If
`PRIVATE_BOOKING_DETAILS_CALENDAR_ID` is unset, the formatted email summary is
the private record. If that property is set later, the helper also creates a
private timed event with the customer details.

## Verification

After setup, submit a test booking.

Expected behavior:

1. Formspark receives the submission.
2. Frannie receives an approval email with confirm and decline links.
3. The calendar stays unchanged until confirm is clicked.
4. Confirm creates a gray all-day `Booked` event.
5. A second booking request for the same date is rejected as already booked.

Run `testCalendarWrite` from the Apps Script editor to verify calendar write
permission. It creates a yellow all-day test event on today's date in
`TIME_ZONE`; delete the test event afterwards.

## Common Changes

Change contact links:

1. Update `.env`.
2. Run `make config` for local preview.
3. Update matching GitHub repository variables for production.

Change the public booking calendar:

1. Update `FRANNIE_PUBLIC_CALENDAR_ID`.
2. Update Apps Script `BOOKING_CALENDAR_ID`.
3. Confirm the Apps Script account owns or can write to the calendar.
4. Redeploy only if `.gs` code changed.

Change blocked-private-calendar behavior:

1. Update Apps Script `BLOCKING_CALENDAR_IDS`.
2. Update `.env` only if you use it as the deployment checklist source.
3. No Apps Script redeploy is needed for Script Property changes.

Update Yelp reviews:

1. Edit the review cards in `index.html`.
2. Keep excerpts manually curated.
3. Do not expose a Yelp API key in browser code.

Update the About hero image:

1. Swap `assets/frannie-veteran.jpg`, or add a new image under `assets/`.
2. Update the About page `<img>` dimensions if the image file changes.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Live calendar shows the wrong calendar | Deployed `site-config.js` has stale `PUBLIC_CALENDAR_ID` | Fetch the live `site-config.js`, then check GitHub repository variables |
| Confirmed events appear in Google Calendar but not on the website | Browser config calendar ID differs from Apps Script `BOOKING_CALENDAR_ID` | Make `FRANNIE_PUBLIC_CALENDAR_ID` and `BOOKING_CALENDAR_ID` point to the same public booking calendar |
| Apps Script cannot create events | Script owner lacks write access or calendar ID is wrong | Run `testCalendarWrite` and verify calendar ownership |
| Formspark submissions arrive but Frannie gets no approval email | Webhook URL, `booking_key`, or Apps Script deployment is wrong | Confirm Formspark points to the current `/exec` URL and secret |
| Confirm links fail | Apps Script does not know its deployed URL | Set `WEB_APP_URL` to the current `/exec` URL |
| Spam burns Formspark quota | Spam check runs only in Apps Script | Configure Formspark-side spam protection first |
| Code edits do not affect live webhook | Apps Script deployment was not updated | Create a new deployment version or update the existing deployment |
