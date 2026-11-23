import { json } from "../_lib.js";
export async function onRequestPost() {
  return json({ ok: true }, 200, { "Set-Cookie": "ohio_hq_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0" });
}
