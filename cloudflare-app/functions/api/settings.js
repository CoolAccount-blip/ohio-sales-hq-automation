import { json, requireAuth } from "../_lib.js";
import { saveSettings } from "../_google.js";
export async function onRequestPost({ request, env }) {
  const denied = await requireAuth(request, env); if (denied) return denied;
  let settings;
  try { settings = await request.json(); } catch { return json({ok:false,error:"Invalid settings."},400); }
  try { return json({ok:true,settings:await saveSettings(env,settings)}); }
  catch (e) { return json({ok:false,error:e.message||String(e)},400); }
}