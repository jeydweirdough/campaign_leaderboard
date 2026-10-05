import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";

export async function isAdmin() {
  return isValidSession((await cookies()).get(SESSION_COOKIE)?.value);
}

/** Defence in depth for server actions (proxy already guards /admin routes). */
export async function requireAdmin() {
  if (!(await isAdmin())) redirect("/login");
}
