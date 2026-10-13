"use server";

import { and, eq, isNull, lt, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/lib/db";
import { isAdmin } from "@/lib/admin";
import { getCampaignBySlug } from "@/lib/score";
import { syncCampaign } from "@/lib/sync";

/** A click within this long of the last sync just shows the saved data instead of calling Zoho again. */
const COOLDOWN_MS = 2 * 60_000;
/** A lock older than this belongs to a sync that crashed or timed out, so it can be taken over. */
const STALE_LOCK_MS = 6 * 60_000;

export type PublicSyncResult = { ok: true; status: "synced" | "fresh" | "busy" } | { ok: false; error: string };

/** "Sync now" on the public leaderboard: pulls the latest invoices from Zoho. One sync runs at a time per campaign. */
export async function syncFromLeaderboard(slug: string): Promise<PublicSyncResult> {
  const campaign = await getCampaignBySlug(slug);
  if (!campaign || (campaign.status === "draft" && !(await isAdmin()))) return { ok: false, error: "Leaderboard not found." };
  if (campaign.status === "closed") return { ok: false, error: "This campaign has ended. The results are final." };

  const now = Date.now();
  if (campaign.lastSyncedAt && now - Date.parse(campaign.lastSyncedAt) < COOLDOWN_MS) return { ok: true, status: "fresh" };

  // Take the lock in a single UPDATE so two visitors clicking together can't both start a sync.
  const startedAt = new Date(now).toISOString();
  const claimed = await db
    .update(schema.campaigns)
    .set({ syncStartedAt: startedAt })
    .where(
      and(
        eq(schema.campaigns.id, campaign.id),
        or(isNull(schema.campaigns.syncStartedAt), lt(schema.campaigns.syncStartedAt, new Date(now - STALE_LOCK_MS).toISOString())),
      ),
    )
    .returning({ id: schema.campaigns.id });
  if (!claimed.length) return { ok: true, status: "busy" };

  try {
    await syncCampaign(campaign.id);
    return { ok: true, status: "synced" };
  } catch (e) {
    console.error(`[public-sync] ${slug}: ${(e as Error).message}`);
    return { ok: false, error: "Couldn't reach Zoho right now. Please try again in a few minutes." };
  } finally {
    await db.update(schema.campaigns).set({ syncStartedAt: null }).where(eq(schema.campaigns.id, campaign.id));
    revalidatePath(`/c/${slug}`, "layout");
  }
}
