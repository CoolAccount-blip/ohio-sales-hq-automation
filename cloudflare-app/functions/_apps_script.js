export async function callAppsScript(env, action, payload = {}) {
  const url = String(env.SHEETS_WEBHOOK_URL || "").trim();
  const secret = String(env.SHEETS_WEBHOOK_SECRET || "").trim();
  if (!url || !secret) {
    throw new Error("Apps Script connection is not configured in Cloudflare. Add SHEETS_WEBHOOK_URL and SHEETS_WEBHOOK_SECRET as Production secrets to enable live research settings and email outreach.");
  }
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, action, token: secret })
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; }
  catch { throw new Error("Apps Script returned an unexpected response. Check that its Web App deployment is active."); }
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || "Apps Script request failed (" + response.status + ").");
  }
  return data;
}
