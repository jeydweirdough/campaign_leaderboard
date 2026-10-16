import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { pruneRateLimits } from "@/lib/rate-limit";
import { syncWithLock } from "@/lib/sync";

export const maxDuration = 300;

/**
 * Scheduled sync of every live Zoho campaign.
 * Call with `Authorization: Bearer $CRON_SECRET` (Vercel Cron sends this automatically).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const live = await db
    .select({ id: schema.campaigns.id, slug: schema.campaigns.slug })
    .from(schema.campaigns)
    .where(and(eq(schema.campaigns.status, "live"), eq(schema.campaigns.dataSource, "zoho")));

  const results: Record<string, unknown> = {};
  for (const c of live) {
    try {
      results[c.slug] = (await syncWithLock(c.id)) ?? { skipped: "another sync was already running" };
    } catch (e) {
      results[c.slug] = { error: (e as Error).message };
    }
  }
  await pruneRateLimits().catch((e) => console.error(`[cron] prune rate limits: ${(e as Error).message}`));
  return Response.json({ synced: live.length, results });
}
