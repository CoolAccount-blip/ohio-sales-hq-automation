import { json, requireAuth } from "../../_lib.js";
import { saveCall } from "../../_google.js";
export async function onRequestPost({ request, env }) {
  const denied = await requireAuth(request, env); if (denied) return denied;
  let body;
  try { body = await request.json(); } catch { return json({ok:false,error:"Invalid call update."},400); }
  try { return json(await saveCall(env,body)); }
  catch (e) { return json({ok:false,error:e.message||String(e)},400); }
}