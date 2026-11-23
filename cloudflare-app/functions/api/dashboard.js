import { json, requireAuth } from "../_lib.js";
import { dashboard } from "../_google.js";
export async function onRequestGet({ request, env }) {
  const denied = await requireAuth(request, env); if (denied) return denied;
  try { return json(await dashboard(env)); }
  catch (e) { return json({ok:false,error:e.message||String(e)}, 502); }
}