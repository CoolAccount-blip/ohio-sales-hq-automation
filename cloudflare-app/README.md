# Ohio Sales HQ — Cloudflare Pages

## Cloudflare Pages build settings
- GitHub repository: `CoolAccount-blip/ohio-sales-hq-automation`
- Production branch: `main`
- Root directory: `cloudflare-app`
- Build command: `exit 0`
- Build output directory: `public`

## Cloudflare Production variables and secrets
Set these in Workers & Pages → your Pages project → Settings → Variables and Secrets.

**Secrets**
- `APP_PASSWORD` — choose a new, strong password for signing into the app.
- `SESSION_SECRET` — a unique random secret of at least 32 characters.
- `GOOGLE_SERVICE_ACCOUNT_JSON` — the entire contents of the downloaded Google service-account JSON key file. Store as a secret.

**Plain-text variable**
- `GOOGLE_SPREADSHEET_ID` — the ID in the spreadsheet URL between `/d/` and `/edit`.

Set these for Production. Do not add the JSON key or passwords to GitHub, this README, or chat.

## Google Sheets access
The Google service account must have Editor access to the spreadsheet. Cloudflare Pages Functions authenticate with this service account and call the Google Sheets API directly. The Cloudflare app does not use an Apps Script URL or webhook secret.

## Current app features
- Private password login with a signed, HttpOnly session cookie.
- Dashboard metrics from Prospects, Discovery Inbox, and Call Queue.
- Searchable, paginated Prospects.
- Call Queue, click-to-call links, and outcome / notes / follow-up editing.
- App Settings tab for saving research preferences.

## Migration status — important
The Cloudflare app now reads and writes Google Sheets directly. The scheduled Python email-research workflow, Gmail sender, and reply tracker still use parts of the existing Apps Script automation. The App Settings tab created by this Cloudflare app does not yet control the legacy worker's schedule. Those pieces need their own migration before the entire system is Apps Script-free.
