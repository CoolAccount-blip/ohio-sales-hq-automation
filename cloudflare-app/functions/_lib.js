const COOKIE_NAME = "ohio_hq_session";
const SESSION_SECONDS = 60 * 60 * 24 * 7;

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }
  });
}

function b64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromB64url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export async function createSessionCookie(env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters.");
  }
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS })));
  const signature = b64url(await hmac(payload, env.SESSION_SECRET));
  return COOKIE_NAME + "=" + payload + "." + signature +
    "; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=" + SESSION_SECONDS;
}

export async function isAuthenticated(request, env) {
  try {
    if (!env.SESSION_SECRET) return false;
    const cookieHeader = request.headers.get("Cookie") || "";
    const entry = cookieHeader.split(";").map(v => v.trim()).find(v => v.startsWith(COOKIE_NAME + "="));
    if (!entry) return false;
    const token = entry.slice(COOKIE_NAME.length + 1);
    const parts = token.split(".");
    if (parts.length !== 2) return false;
    const expected = b64url(await hmac(parts[0], env.SESSION_SECRET));
    if (!constantTimeEqual(expected, parts[1])) return false;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
    return Number(payload.exp) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export async function requireAuth(request, env) {
  if (!(await isAuthenticated(request, env))) return json({ ok: false, error: "Please sign in again." }, 401);
  return null;
}

export async function callAppsScript(env, action, payload = {}) {
  if (!env.APPS_SCRIPT_URL || !env.WEBHOOK_SECRET) {
    return json({ ok: false, error: "The Sheets connection has not been configured yet. Add APPS_SCRIPT_URL and WEBHOOK_SECRET in Cloudflare settings." }, 503);
  }
  let response;
  try {
    response = await fetch(env.APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: env.WEBHOOK_SECRET, action, ...payload }),
      redirect: "follow"
    });
  } catch (error) {
    return json({ ok: false, error: "Could not reach the Google Sheets connection: " + String(error.message || error) }, 502);
  }
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); }
  catch { return json({ ok: false, error: "The Sheets connection returned an unexpected response. Check that the Apps Script web app is deployed and the webhook secret matches." }, 502); }
  if (!response.ok || data.ok === false) return json({ ok: false, error: data.error || "The Sheets request failed." }, 502);
  return json(data);
}
