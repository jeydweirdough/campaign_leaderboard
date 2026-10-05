import "server-only";
import { and, eq, gte, lte, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { parseRuleset } from "@/lib/rules/schema";
import { doctorKey } from "@/lib/rules/engine";
import { sourceFor, type DoctorHistoryHit } from "@/lib/zoho/source";
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
    .select({ date: schema.invoices.date, doctorName: schema.invoices.doctorName, status: schema.invoices.status, id: schema.invoices.id })
    .from(schema.invoices)
    .where(and(gte(schema.invoices.date, campaign.startDate), lte(schema.invoices.date, campaign.endDate)));
  const excluded = new Set(fields.excludedStatuses.map((s) => s.toLowerCase()));
  const firstByDoctor = new Map<string, { date: string; names: Set<string> }>();
  for (const inv of periodInvoices.sort((a, b) => a.date.localeCompare(b.date))) {
    if (excluded.has(inv.status.toLowerCase()) || inv.id.startsWith("demo-") !== isDemo) continue;
    const key = doctorKey(inv.doctorName, fields.blankDoctorValues);
    if (!key) continue;
    const entry = firstByDoctor.get(key) ?? { date: inv.date, names: new Set<string>() };
    entry.names.add(inv.doctorName);
    firstByDoctor.set(key, entry);
  }
  const existingHistory = await db.query.doctorHistory.findMany({ where: eq(schema.doctorHistory.campaignId, campaignId) });
  const historyMap = new Map(existingHistory.map((h) => [h.doctorKey, h]));

  for (const [key, { date, names }] of firstByDoctor) {
    if (historyMap.get(key)?.checkedBefore === date) continue;
    try {
      let last: DoctorHistoryHit | null = null;
      for (const name of names) {
        const hit = await source.lastDoctorInvoiceBefore(name, date, fields);
        if (hit && (!last || hit.date > last.date)) last = hit;
      }
      summary.doctorsChecked++;
      if (dryRun) continue;
      const values = {
        campaignId, doctorKey: key, doctorName: [...names][0], checkedBefore: date,
        lastInvoiceDate: last?.date ?? null, lastInvoiceNumber: last?.number ?? null,
        matchedName: last?.matchedName ?? null, matchConfidence: last?.confidence ?? null, checkedAt: new Date().toISOString(),
      };
      await db.insert(schema.doctorHistory).values(values).onConflictDoUpdate({
        target: [schema.doctorHistory.campaignId, schema.doctorHistory.doctorKey],
        set: values,
      });
    } catch (e) {
      summary.errors.push(`doctor ${key}: ${(e as Error).message}`);
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
