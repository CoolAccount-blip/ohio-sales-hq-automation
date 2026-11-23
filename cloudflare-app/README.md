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
- Searchable, paginated Prospects with the source lead score, qualification details, and personalized subject/body.
- Per-prospect Gmail compose that uses the saved subject/body verbatim; the user reviews and sends in Gmail. No footer is appended by the app.
- Full Call Queue details: fit score, company overview/research notes, source, website, ranking explanation, suggested call script, click-to-call, and outcome / notes / follow-up editing.
- App Settings tab. The updated Apps Script receiver reads this tab so the existing GitHub Actions email-research worker follows the preferences on its next scheduled run.

## Automation architecture
The website-email crawler should remain in Python on GitHub Actions for now. It already performs official-site-only contact research, public-host validation, robots.txt checks, timeouts, and retry handling. Moving that crawler into Cloudflare would add a second implementation without improving the current workflow.

The dashboard stores research settings in the `App Settings` sheet. The updated `apps_script_receiver.gs` reads those values when the existing GitHub Actions worker asks for its next email queue, so the current crawler follows the website's run frequency, batch size, pages-per-site, retry window, and enabled/paused preference. After updating the receiver source in the bound Apps Script project, deploy a new Web App version for this settings sync to take effect. Keep the existing GitHub Actions schedule and webhook secrets unchanged.

The Gmail batch sender and reply tracker remain separate legacy Apps Script features. The Cloudflare app's prospect detail view opens a Gmail compose window with the saved address, subject, and body; the user reviews and clicks Send in Gmail. Live batch sending from the web app is not enabled.
