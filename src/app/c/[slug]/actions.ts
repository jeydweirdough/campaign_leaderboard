"use server";

import { and, count, eq, gte } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/lib/db";
import { isAdmin } from "@/lib/admin";
import { clientIp, hit } from "@/lib/rate-limit";
import { getCampaignBySlug } from "@/lib/score";
import { syncWithLock } from "@/lib/sync";

/** A click within this long of the last sync just shows the saved data instead of calling Zoho again. */
const COOLDOWN_MS = 2 * 60_000;
/** Each visitor (by IP) gets this many "Sync now" clicks per window, across all campaigns. */
const CLICKS_PER_IP = 5;
const CLICK_WINDOW_MS = 10 * 60_000;
/** At most this many Zoho syncs per campaign per hour (cron and admin syncs count too), to protect the Zoho API quota. */
const SYNCS_PER_HOUR = 10;

export type PublicSyncResult = { ok: true; status: "synced" | "fresh" | "busy" } | { ok: false; error: string };

const minutes = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));

/**
 * "Sync now" on the public leaderboard: pulls the latest invoices from Zoho. One sync runs at a time per campaign.
 * Never throws: an error escaping a server action replaces the whole page with Next's error screen.
 */
export async function syncFromLeaderboard(slug: string): Promise<PublicSyncResult> {
  try {
    return await sync(slug);
  } catch (e) {
    console.error(`[public-sync] ${slug}: ${(e as Error).message}`);
    return { ok: false, error: "Sync isn't available right now. Please try again later." };
  }
}

async function sync(slug: string): Promise<PublicSyncResult> {
  const campaign = await getCampaignBySlug(slug);
  if (!campaign || (campaign.status === "draft" && !(await isAdmin()))) return { ok: false, error: "Leaderboard not found." };
  if (campaign.status === "closed") return { ok: false, error: "This campaign has ended. The results are final." };

  const limit = await hit(`sync:${await clientIp()}`, CLICKS_PER_IP, CLICK_WINDOW_MS);
  if (!limit.ok) return { ok: false, error: `Too many sync requests. Try again in ${minutes(limit.retryAfterMs)} min.` };

  const now = Date.now();
  if (campaign.lastSyncedAt && now - Date.parse(campaign.lastSyncedAt) < COOLDOWN_MS) return { ok: true, status: "fresh" };

  const [recent] = await db
    .select({ n: count() })
    .from(schema.syncLogs)
    .where(and(eq(schema.syncLogs.campaignId, campaign.id), gte(schema.syncLogs.startedAt, new Date(now - 3_600_000).toISOString())));
  if (recent.n >= SYNCS_PER_HOUR) return { ok: false, error: "The leaderboard has been synced a lot this hour. Please try again later." };

  try {
    const summary = await syncWithLock(campaign.id);
    return { ok: true, status: summary ? "synced" : "busy" };
  } catch (e) {
    console.error(`[public-sync] ${slug}: ${(e as Error).message}`);
    return { ok: false, error: "Couldn't reach Zoho right now. Please try again in a few minutes." };
  } finally {
    revalidatePath(`/c/${slug}`, "layout");
  }
}
