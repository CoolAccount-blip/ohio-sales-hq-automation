import { json, isAuthenticated } from "../_lib.js";
export async function onRequestGet({ request, env }) {
  return json({ ok: true, authenticated: await isAuthenticated(request, env) });
}
