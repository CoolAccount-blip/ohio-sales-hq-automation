# Ohio Sales HQ — Cloudflare Pages

## Cloudflare Pages build settings
- Connect the GitHub repository: `CoolAccount-blip/ohio-sales-hq-automation`
- Production branch: `main`
- Root directory: `cloudflare-app`
- Build command: `exit 0` (Cloudflare's recommended no-build command for a static site with Pages Functions)
- Build output directory: `public`

## Production environment variables / secrets
Add these in Workers & Pages → your Pages project → Settings → Variables and Secrets:

- `APP_PASSWORD` — a new, strong, private password used to sign in to the app.
- `SESSION_SECRET` — a random secret at least 32 characters long. Do not reuse an API key or webhook token.
- `APPS_SCRIPT_URL` — the existing Apps Script Web App URL ending in `/exec`.
- `WEBHOOK_SECRET` — the same value stored as `WEBHOOK_SECRET` in Apps Script Script Properties / the GitHub Actions secret.

Mark all four as secrets where Cloudflare offers that option. Set them for Production. Add them to Preview only if you intend to use preview deployments.

## Google Apps Script bridge update
The repository's `apps_script_receiver.gs` now supports the private app actions:
- `app_dashboard`
- `app_leads`
- `app_calls`
- `app_save_settings`
- `app_save_call`
- `app_refresh_calls`

Copy the updated file into the existing bound Apps Script project, save, and deploy a new Web App version. Keep the existing deployment URL and access setting used by GitHub Actions. Do not create a second webhook secret.

The browser never receives the webhook secret. Cloudflare Pages Functions call Apps Script server-to-server after checking the app's signed, HttpOnly session cookie.

## Current scope
Overview, searchable Prospects, Call Queue, call outcome/notes/follow-up editing, and adjustable email research/appearance settings. Reply tracking and email sending are not exposed in this first Cloudflare version yet; existing automation remains in place.

## Launch checklist
1. Create a Pages project using Git integration and select this repository.
2. Use the settings above. Choose a unique project name such as `ohio-sales-hq`.
3. Add the four Production secrets before the first working deployment.
4. Update the existing Apps Script receiver file as described above, then edit its existing Web App deployment to use a new version. Keep its existing URL so the GitHub worker does not need to change.
5. Trigger a new Pages deployment after saving the secrets.
6. Open the `*.pages.dev` URL and sign in with your `APP_PASSWORD`.

Do not paste secret values into GitHub, this README, or ChatGPT. Do not put them in a `.js` or `.html` file.
