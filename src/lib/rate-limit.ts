import "server-only";
import { lt, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { db, schema } from "@/lib/db";

/**
 * Counts one hit against `key` and reports whether it's within `limit` per `windowMs`.
 * Fixed window, stored in Postgres so it holds across serverless instances. A single
 * upsert does the read and the increment, so concurrent requests can't both slip under the limit.
 */
export async function hit(key: string, limit: number, windowMs: number): Promise<{ ok: boolean; retryAfterMs: number }> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - windowMs).toISOString();
  const t = schema.rateLimits;
  const [row] = await db
    .insert(t)
    .values({ key, windowStart: now.toISOString(), count: 1 })
    .onConflictDoUpdate({
      target: t.key,
      set: {
        count: sql`case when ${t.windowStart} < ${cutoff} then 1 else ${t.count} + 1 end`,
        windowStart: sql`case when ${t.windowStart} < ${cutoff} then ${now.toISOString()} else ${t.windowStart} end`,
      },
    })
    .returning({ count: t.count, windowStart: t.windowStart });
  const retryAfterMs = Math.max(0, Date.parse(row.windowStart) + windowMs - now.getTime());
  return { ok: row.count <= limit, retryAfterMs };
}

/** Deletes counters whose window ended more than a day ago. */
export async function pruneRateLimits() {
  await db.delete(schema.rateLimits).where(lt(schema.rateLimits.windowStart, new Date(Date.now() - 86_400_000).toISOString()));
}

/** The visitor's IP as reported by Vercel's proxy (or "unknown" locally). */
export async function clientIp() {
  const h = await headers();
  return h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}
