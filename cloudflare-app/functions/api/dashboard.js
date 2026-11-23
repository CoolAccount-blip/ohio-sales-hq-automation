import { json, requireAuth, callAppsScript } from "../_lib.js";
export async function onRequestGet({ request, env }) {
  const denied = await requireAuth(request, env); if (denied) return denied;
  return callAppsScript(env, "app_dashboard");
}
