import { json, requireAuth } from "../_lib.js";
import { calls } from "../_google.js";
export async function onRequestGet({ request, env }) {
  const denied = await requireAuth(request, env); if (denied) return denied;
  const u = new URL(request.url);
  try { return json(await calls(env,u.searchParams.get("q")||"")); }
  catch (e) { return json({ok:false,error:e.message||String(e)}, 502); }
}