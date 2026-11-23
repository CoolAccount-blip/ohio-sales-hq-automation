import { json, requireAuth } from "../../_lib.js";
import { refreshCalls } from "../../_google.js";
export async function onRequestPost({ request, env }) {
  const denied = await requireAuth(request, env); if (denied) return denied;
  try { return json(await refreshCalls(env)); }
  catch (e) { return json({ok:false,error:e.message||String(e)},502); }
}