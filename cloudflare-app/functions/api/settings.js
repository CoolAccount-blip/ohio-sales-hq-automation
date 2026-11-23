import { json, requireAuth, callAppsScript } from "../_lib.js";
export async function onRequestPost({ request, env }) {
  const denied = await requireAuth(request, env); if (denied) return denied;
  let settings;
  try { settings = await request.json(); } catch { return json({ ok: false, error: "Invalid settings." }, 400); }
  return callAppsScript(env, "app_save_settings", { settings });
}
