OHIO SALES HQ — AUTOMATION STARTER (EMAIL-FIRST VERSION)
========================================================

WHAT THIS PACKAGE DOES
---------------------
1. Weekly discovery: downloads the free Ohio OpenStreetMap extract from Geofabrik,
   then finds named businesses in the target categories (plumbing, HVAC, electrical,
   roofing, landscaping, dentists, orthodontists, dermatology and tagged cosmetic/laser
   clinics). It does not query or scrape Google Maps.
2. Spreadsheet deduplication: checks incoming records against BOTH Prospects and
   Discovery Inbox. It blocks/merges identical OSM IDs and exact normalized
   business-name + address, phone + address, or website host + address matches. Missing website, phone or public email data is
   merged into the existing prospect rather than creating another lead.
3. Uncertain matches: if the normalized business name and city match but the address
   differs or is missing, the new row is flagged in Possible Duplicate for review.
   It is not auto-deleted because it could be a second location.
4. Email research: a separate daily job takes up to 20 queued websites from the sheet.
   It checks the business's own website homepage and a small number of contact/about
   pages. It looks for mailto links, visible email text and public structured contact
   data. It checks robots.txt, uses a delay between pages and skips social/directory
   profile URLs.
5. Audit trail: records automation runs and duplicate removals in Automation Log and
   Duplicate Log. The email source page, email type, confidence and checked date are
   stored next to the public email.

IMPORTANT EMAIL LIMITATION
-------------------------
An email is only added when it was actually published in an OSM contact tag or on the
business's official website. The script never guesses info@/contact@ addresses. It does
not test whether a mailbox accepts mail, and it does not send outreach. "High confidence"
means the address was published on the official website; it does NOT mean delivery was
verified. Your existing approval-based email sender remains separate and unchanged.

CURRENT TRACKER SNAPSHOT
------------------------
The workbook version reviewed for this build has 570 Prospects rows. 515 have a Website
URL and 83 have a non-placeholder Public Email, leaving 435 existing rows with a website but no listed public email eligible for website email research when setupAutomation() initializes the queue. Some sites may
block automated requests, have no published email, or use a contact form only.

INSTALL INTO YOUR EXISTING GOOGLE SHEET
---------------------------------------
A. Apps Script setup (do this before GitHub)
1. Open the Google Sheet that contains Dashboard, Prospects and Suppression List (DNC).
2. Open Extensions > Apps Script.
3. IMPORTANT: create a NEW script file named AutomationReceiver. Do not replace or
   delete the existing approved-email sender code.
4. Open apps_script_receiver.gs from this package, copy all its contents into the new
   AutomationReceiver.gs file, and save.
5. In Project Settings > Script properties, add:
      Property: WEBHOOK_SECRET
      Value: a random secret generated privately on your Mac
   For example, Terminal can generate one with: openssl rand -hex 32
   Do not send the secret in chat or put it in the code.
6. In the function selector, choose setupAutomation and click Run. Approve the Google
   permissions prompt. This adds automation metadata columns to Prospects and creates
   Discovery Inbox, Duplicate Log and Automation Log. It does not delete prospects or
   change your personalized email formulas.
7. Deploy > New deployment > Web app.
      Execute as: Me
      Who has access: Anyone
   Deploy and copy the URL ending in /exec. Use the /exec URL, not /dev.
   If your Google account does not offer Anyone access, stop here and tell me the exact
   message; do not weaken other spreadsheet permissions.

B. GitHub setup (source code only)
8. Create a NEW public GitHub repository, for example ohio-sales-hq-automation.
   Upload the contents of this package, preserving the .github/workflows folder.
   Public runner use is free for standard GitHub-hosted runners, but the repository's
   code and workflow logs are public. This package therefore avoids writing business
   names, website URLs or email addresses to workflow logs. Do NOT upload your tracker,
   CSVs, lead data, API keys or the webhook secret to the repository.
9. In the repository, open Settings > Secrets and variables > Actions > New repository
   secret. Add these two secrets:
      SHEETS_WEBHOOK_URL = the Apps Script /exec URL
      SHEETS_WEBHOOK_SECRET = the same secret used in Apps Script
10. Open Actions and enable workflows if GitHub asks.

FIRST TEST — PROCESS EMAILS ALREADY IN YOUR TRACKER
--------------------------------------------------
11. In Actions, select "Find Public Business Emails" > Run workflow.
    This runs the email queue without downloading the OSM file. It processes up to 20
    queued websites and writes results back to Public Email plus the source/status
    columns. Run it again manually to process another batch. A daily schedule is also
    included to drain the remaining queue gradually.
12. Check Prospects. Look at Public Email, Email Source URL, Email Type, Email
    Confidence, Email Checked At and Email Research Status. The automation log shows
    how many results were processed.

SECOND TEST — DISCOVER NEW OHIO BUSINESSES
------------------------------------------
13. After the email queue is working, open Actions > "Discover Ohio Businesses" > Run
    workflow. It downloads the Ohio OSM extract and sends new/changed records to the
    Apps Script endpoint. Exact matches are merged into existing Prospects or Inbox
    rows; genuinely new businesses go to Discovery Inbox for review. It never marks
    new discoveries as Ready for Approval and never sends an email.
14. Review Discovery Inbox and any Possible Duplicate flags before manually promoting
    a new business into Prospects.

OPTIONAL CLEANUP OF DUPLICATES ALREADY IN THE TRACKER
----------------------------------------------------
15. In Apps Script, choose cleanupExistingDuplicates and click Run only after setup.
    It first creates timestamped backup copies of Prospects and Discovery Inbox. It
    then merges and deletes only exact normalized name+address, phone+address, website-host+address matches, or identical OSM IDs, including duplicates between Prospects and Discovery Inbox. Ambiguous same-name/different-address rows are left alone for review. Check Duplicate Log.

LOCAL TESTS
-----------
Run these from the package folder before deployment:
  python tests_test_email_enricher.py
  node tests_test_dedupe_logic.js
  node tests_test_apps_script.js

These are offline parser/mock-sheet tests; they do not prove a live Google deployment.

FILES
-----
apps_script_receiver.gs             Google Sheets receiver, dedupe and audit log
discover_osm.py                    OpenStreetMap Ohio discovery
email_enricher.py                  Official-website public email finder
.github/workflows/discover-ohio.yml Weekly discovery workflow
.github/workflows/enrich-ohio-emails.yml Daily email research queue
requirements.txt                   Python dependency list
tests_test_email_enricher.py       Offline email extraction checks
tests_test_dedupe_logic.js          Offline matching-key checks
tests_test_apps_script.js           Mock spreadsheet integration checks

COST / LIMITS / LICENSE
-----------------------
- No paid API, Google Maps API, SerpData credits, credit card or paid cloud service is
  needed for this starter. The Geofabrik extract is available free of charge.
- Standard GitHub-hosted runners are free for public repositories. Keep all lead data
  in Google Sheets; only the code belongs in the public repository.
- Google Apps Script has quotas and a six-minute execution limit. Current quota details
  are documented at https://developers.google.com/apps-script/guides/services/quotas
  and can change. The webhook processes small batches to keep each call bounded.
- OpenStreetMap data is licensed under ODbL. Review attribution/share-alike obligations
  before publishing or redistributing a database derived from it:
  https://www.openstreetmap.org/copyright
- Website research checks robots.txt, does not log into sites, submit forms, bypass
  controls, or crawl external social profiles. Respect website terms; remove any site
  from the queue if its owner prohibits automated access.

TROUBLESHOOTING
---------------
- Unauthorized: the Apps Script WEBHOOK_SECRET and GitHub SHEETS_WEBHOOK_SECRET differ.
- Google permissions error: run setupAutomation() manually from the editor and approve
  the requested permissions.
- GitHub returns 404/HTML instead of JSON: redeploy the Apps Script web app and confirm
  the secret URL ends in /exec.
- No queued email research: check that Website URL is populated and Email Research
  Status is Pending. Existing non-placeholder Public Email values are not rechecked.
- Stuck Processing rows are eligible to return to the queue after 24 hours.
