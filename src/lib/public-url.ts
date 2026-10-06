import "server-only";
import { headers } from "next/headers";

/**
 * Base URL people should use to open the site (for QR codes and share links).
 * Set PUBLIC_BASE_URL in production; otherwise falls back to the host the page was requested on.
 */
export async function publicBaseUrl() {
  const configured = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
  if (configured) return configured;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
