import "server-only";
import { and, eq, gte, lte, inArray, isNull, lt, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { parseRuleset } from "@/lib/rules/schema";
import { doctorKey } from "@/lib/rules/engine";
import { pickLastInvoice, sourceFor, type DoctorHistoryHit } from "@/lib/zoho/source";
import { compareDoctors } from "@/lib/rules/doctor-match";
import { zohoConfig } from "@/lib/zoho/client";

export type SyncSummary = {
  dryRun: boolean;
  resolvedItems: number;
  unresolvedItems: string[];
  listed: number;
  fetched: number;
  unchanged: number;
  removed: number;
  doctorsChecked: number;
  customersChecked: number;
  errors: string[];
};

/** A lock older than this belongs to a sync that crashed or timed out, so it can be taken over. */
const STALE_LOCK_MS = 6 * 60_000;

/**
 * Runs syncCampaign while holding the campaign's sync lock, so the public button, the admin
 * button and the cron job never run overlapping syncs. Returns null if another sync holds the lock.
 */
export async function syncWithLock(campaignId: string): Promise<SyncSummary | null> {
  const now = Date.now();
  // Take the lock in a single UPDATE so two callers arriving together can't both start a sync.
  const claimed = await db
    .update(schema.campaigns)
    .set({ syncStartedAt: new Date(now).toISOString() })
    .where(
      and(
        eq(schema.campaigns.id, campaignId),
        or(isNull(schema.campaigns.syncStartedAt), lt(schema.campaigns.syncStartedAt, new Date(now - STALE_LOCK_MS).toISOString())),
      ),
    )
    .returning({ id: schema.campaigns.id });
  if (!claimed.length) return null;
  try {
    return await syncCampaign(campaignId);
  } finally {
    await db.update(schema.campaigns).set({ syncStartedAt: null }).where(eq(schema.campaigns.id, campaignId));
  }
}

const today = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10); // Asia/Manila

/**
 * Pulls focus-product invoices for the campaign period into the local cache
 * and looks up each doctor's prior invoice history. Read-only against Zoho.
 */
export async function syncCampaign(campaignId: string): Promise<SyncSummary> {
  const campaign = await db.query.campaigns.findFirst({ where: eq(schema.campaigns.id, campaignId) });
  if (!campaign) throw new Error("Campaign not found");

  const isDemo = campaign.dataSource === "demo";
  const dryRun = isDemo ? false : zohoConfig().dryRun;
  if (!isDemo && zohoConfig().mode !== "live") throw new Error("ZOHO_MODE is not 'live'; Zoho sync is disabled.");

  const source = sourceFor(campaign.dataSource);
  const ruleset = parseRuleset(campaign.ruleset);
  const fields = ruleset.zoho;
  const summary: SyncSummary = {
    dryRun, resolvedItems: 0, unresolvedItems: [], listed: 0, fetched: 0, unchanged: 0, removed: 0, doctorsChecked: 0, customersChecked: 0, errors: [],
  };
  const startedAt = new Date().toISOString();

  // 1. Resolve item ids for products configured by name only.
  let rulesetChanged = false;
  for (const g of ruleset.productGroups) {
    for (const p of g.products) {
      if (p.itemId) continue;
      const id = await source.resolveItemId(p.name);
      if (id) {
        p.itemId = id;
        rulesetChanged = true;
        summary.resolvedItems++;
      } else summary.unresolvedItems.push(p.name);
    }
  }
  if (rulesetChanged && !dryRun) {
    await db.update(schema.campaigns).set({ ruleset }).where(eq(schema.campaigns.id, campaignId));
  }
  const itemIds = ruleset.productGroups.flatMap((g) => g.products.map((p) => p.itemId).filter((x): x is string => !!x));

  // 2. List and fetch changed invoices.
  const end = campaign.endDate < today() ? campaign.endDate : today();
  const listed = itemIds.length ? await source.listFocusInvoices(itemIds, campaign.startDate, end) : [];
  summary.listed = listed.length;

  const cached = await db
    .select({ id: schema.invoices.id, lastModified: schema.invoices.lastModified })
    .from(schema.invoices)
    .where(and(gte(schema.invoices.date, campaign.startDate), lte(schema.invoices.date, campaign.endDate)));
  const cachedMap = new Map(cached.map((c) => [c.id, c.lastModified]));

  for (const row of listed) {
    if (cachedMap.get(row.id) === row.lastModified) {
      summary.unchanged++;
      continue;
    }
    try {
      const fact = await source.getInvoice(row.id, fields);
      summary.fetched++;
      if (dryRun) continue;
      const values = { ...fact, fetchedAt: new Date().toISOString() };
      await db.insert(schema.invoices).values(values).onConflictDoUpdate({ target: schema.invoices.id, set: values });
    } catch (e) {
      summary.errors.push(`${row.id}: ${(e as Error).message}`);
    }
  }

  // Invoices no longer returned (deleted, or focus item removed) drop out of the cache.
  // Skip if listing failed to return anything for a non-empty cache — likely an outage, not a mass deletion.
  const listedIds = new Set(listed.map((l) => l.id));
  const stale = cached.filter((c) => !listedIds.has(c.id) && c.id.startsWith("demo-") === isDemo).map((c) => c.id);
  if (stale.length && listed.length && !dryRun) {
    await db.delete(schema.invoices).where(inArray(schema.invoices.id, stale));
    summary.removed = stale.length;
  }

  // 3. Doctor history: last invoice strictly before each doctor's first focus order in the campaign.
  const periodInvoices = await db
    .select({ date: schema.invoices.date, number: schema.invoices.number, doctorName: schema.invoices.doctorName, status: schema.invoices.status, id: schema.invoices.id })
    .from(schema.invoices)
    .where(and(gte(schema.invoices.date, campaign.startDate), lte(schema.invoices.date, campaign.endDate)));
  const excluded = new Set(fields.excludedStatuses.map((s) => s.toLowerCase()));
  const firstByDoctor = new Map<string, { date: string; number: string; names: Set<string> }>();
  for (const inv of periodInvoices.sort((a, b) => a.date.localeCompare(b.date))) {
    if (excluded.has(inv.status.toLowerCase()) || inv.id.startsWith("demo-") !== isDemo) continue;
    const key = doctorKey(inv.doctorName, fields.blankDoctorValues);
    if (!key) continue;
    const entry = firstByDoctor.get(key) ?? { date: inv.date, number: inv.number, names: new Set<string>() };
    entry.names.add(inv.doctorName);
    firstByDoctor.set(key, entry);
  }
  const existingHistory = await db.query.doctorHistory.findMany({ where: eq(schema.doctorHistory.campaignId, campaignId) });
  const historyMap = new Map(existingHistory.map((h) => [h.doctorKey, h]));

  /** Record a possible same-doctor pair for admin review (an existing verdict is never overwritten). */
  const suggest = async (a: { key: string; name: string; number: string; date: string }, b: typeof a, level: "same" | "possible", reason: string) => {
    if (dryRun || a.key === b.key) return;
    const [x, y] = a.key < b.key ? [a, b] : [b, a];
    await db
      .insert(schema.doctorMatches)
      .values({
        keyA: x.key, keyB: y.key, nameA: x.name, nameB: y.name, level, reason, campaignId,
        evidence: { a: { number: x.number, date: x.date }, b: { number: y.number, date: y.date } },
      })
      .onConflictDoNothing();
  };

  for (const [key, { date, number, names }] of firstByDoctor) {
    const row = historyMap.get(key);
    // Re-check when the cut-off moved, or for rows saved before candidates were stored.
    if (row?.checkedBefore === date && (row.candidates.length || !row.lastInvoiceDate)) continue;
    try {
      const byKey = new Map<string, DoctorHistoryHit>();
      for (const name of names) {
        for (const hit of await source.doctorCandidatesBefore(name, date, fields)) {
          const prev = byKey.get(hit.key);
          if (!prev || hit.date > prev.date) byKey.set(hit.key, hit);
        }
      }
      const hits = [...byKey.values()];
      const last = pickLastInvoice(hits);
      summary.doctorsChecked++;
      if (dryRun) continue;
      const values = {
        campaignId, doctorKey: key, doctorName: [...names][0], checkedBefore: date,
        lastInvoiceDate: last?.date ?? null, lastInvoiceNumber: last?.number ?? null,
        matchedName: last?.matchedName ?? null, matchConfidence: last?.confidence ?? null,
        candidates: hits.map((h) => ({ name: h.matchedName, key: h.key, date: h.date, number: h.number, confidence: h.confidence, reason: h.reason })),
        checkedAt: new Date().toISOString(),
      };
      await db.insert(schema.doctorHistory).values(values).onConflictDoUpdate({
        target: [schema.doctorHistory.campaignId, schema.doctorHistory.doctorKey],
        set: values,
      });
      const self = { key, name: [...names][0], number, date };
      for (const h of hits) {
        if (h.confidence !== "exact") await suggest(self, { key: h.key, name: h.matchedName, number: h.number, date: h.date }, h.confidence, h.reason ?? "");
      }
    } catch (e) {
      summary.errors.push(`doctor ${key}: ${(e as Error).message}`);
    }
  }

  // Spellings of the same doctor *within* the campaign (e.g. "Dr. Osias" and "Dr. Lucille Osias" both in October).
  const campaignDoctors = [...firstByDoctor.entries()].map(([key, v]) => ({ key, name: [...v.names][0], number: v.number, date: v.date }));
  for (let i = 0; i < campaignDoctors.length; i++) {
    for (let j = i + 1; j < campaignDoctors.length; j++) {
      const cmp = compareDoctors(campaignDoctors[i].name, campaignDoctors[j].name);
      if (cmp) await suggest(campaignDoctors[i], campaignDoctors[j], cmp.level, cmp.reason);
    }
  }

  // 4. Customer (hospital) history for per_order rules that require a "new" customer.
  const newCustomerRules = ruleset.rules.filter((r) => r.enabled && r.type === "per_order" && r.newCustomerMonths);
  if (newCustomerRules.length) {
    const sources = newCustomerRules.flatMap((r) => r.sourceFilter.map((s) => s.trim().toLowerCase()));
    const anySource = newCustomerRules.some((r) => !r.sourceFilter.length);
    const rows = await db
      .select({ id: schema.invoices.id, date: schema.invoices.date, status: schema.invoices.status, source: schema.invoices.source, customerId: schema.invoices.customerId, customerName: schema.invoices.customerName })
      .from(schema.invoices)
      .where(and(gte(schema.invoices.date, campaign.startDate), lte(schema.invoices.date, campaign.endDate)));
    const firstByCustomer = new Map<string, { date: string; name: string }>();
    for (const r of rows.sort((a, b) => a.date.localeCompare(b.date))) {
      if (excluded.has(r.status.toLowerCase()) || r.id.startsWith("demo-") !== isDemo) continue;
      if (!anySource && !sources.includes(r.source.trim().toLowerCase())) continue;
      if (!firstByCustomer.has(r.customerId)) firstByCustomer.set(r.customerId, { date: r.date, name: r.customerName });
    }
    const existing = new Map(
      (await db.query.customerHistory.findMany({ where: eq(schema.customerHistory.campaignId, campaignId) })).map((c) => [c.customerId, c]),
    );
    for (const [customerId, { date, name }] of firstByCustomer) {
      if (existing.get(customerId)?.checkedBefore === date) continue;
      try {
        const last = await source.lastCustomerInvoiceBefore(customerId, date, fields.excludedStatuses);
        summary.customersChecked++;
        if (dryRun) continue;
        const values = {
          campaignId, customerId, customerName: name, checkedBefore: date,
          lastInvoiceDate: last?.date ?? null, lastInvoiceNumber: last?.number ?? null, checkedAt: new Date().toISOString(),
        };
        await db.insert(schema.customerHistory).values(values).onConflictDoUpdate({
          target: [schema.customerHistory.campaignId, schema.customerHistory.customerId],
          set: values,
        });
      } catch (e) {
        summary.errors.push(`customer ${name}: ${(e as Error).message}`);
      }
    }
  }

  if (!dryRun) {
    await db.update(schema.campaigns).set({ lastSyncedAt: new Date().toISOString() }).where(eq(schema.campaigns.id, campaignId));
  }
  await db.insert(schema.syncLogs).values({
    campaignId, startedAt, finishedAt: new Date().toISOString(), ok: summary.errors.length === 0, summary: JSON.stringify(summary),
  });
  return summary;
}
