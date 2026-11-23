import { json, createSessionCookie } from "../_lib.js";

export async function onRequestPost({ request, env }) {
  if (!env.APP_PASSWORD || !env.SESSION_SECRET) {
    return json({ ok: false, error: "App login is not configured. Add APP_PASSWORD and SESSION_SECRET in Cloudflare settings." }, 503);
  }
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Enter your app password." }, 400); }
  const supplied = String(body.password || "");
  const expected = String(env.APP_PASSWORD);
  let same = supplied.length === expected.length;
  let mismatch = 0;
  const max = Math.max(supplied.length, expected.length);
  for (let i = 0; i < max; i++) mismatch |= (supplied.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  same = same && mismatch === 0;
  if (!same) return json({ ok: false, error: "That password did not match." }, 401);
  try {
    return json({ ok: true }, 200, { "Set-Cookie": await createSessionCookie(env) });
  } catch (error) {
    return json({ ok: false, error: error.message }, 500);
  }
}
