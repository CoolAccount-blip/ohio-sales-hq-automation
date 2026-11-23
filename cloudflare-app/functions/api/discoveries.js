import { json, requireAuth } from "../_lib.js";
import { discoveries } from "../_google.js";

export async function onRequestGet({ request, env }) {
  const denied = await requireAuth(request, env); if (denied) return denied;
  const u = new URL(request.url);
  try {
    return json(await discoveries(
      env,
      u.searchParams.get("q") || "",
      Number(u.searchParams.get("page") || 1),
      Number(u.searchParams.get("pageSize") || 25)
    ));
  } catch (e) {
    return json({ok:false,error:e.message||String(e)},502);
  }
}
