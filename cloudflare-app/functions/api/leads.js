import { json, requireAuth, callAppsScript } from "../_lib.js";
export async function onRequestGet({ request, env }) {
  const denied = await requireAuth(request, env); if (denied) return denied;
  const u = new URL(request.url);
  return callAppsScript(env, "app_leads", {
    query: u.searchParams.get("q") || "",
    page: Number(u.searchParams.get("page") || 1),
    pageSize: Number(u.searchParams.get("pageSize") || 25)
  });
}
