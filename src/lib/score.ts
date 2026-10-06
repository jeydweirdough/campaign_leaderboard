import "server-only";
import { and, eq, gte, lte } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { computeScores, type ScoreResult } from "@/lib/rules/engine";
import { doctorNameKey } from "@/lib/rules/doctor-match";
import { parseRuleset, type Ruleset } from "@/lib/rules/schema";

export type Campaign = typeof schema.campaigns.$inferSelect;

export async function getCampaignBySlug(slug: string) {
  return db.query.campaigns.findFirst({ where: eq(schema.campaigns.slug, slug) });
}

export async function getCampaign(id: string) {
  return db.query.campaigns.findFirst({ where: eq(schema.campaigns.id, id) });
}

/**
 * Loads every fact for a campaign and runs the scoring engine.
 * `asOf` (YYYY-MM-DD) scores only invoices/claims dated on or before that day — used for rank movement.
 */
export async function scoreCampaign(campaign: Campaign, asOf?: string): Promise<{ ruleset: Ruleset; result: ScoreResult }> {
  const ruleset = parseRuleset(campaign.ruleset);
  const isDemo = campaign.dataSource === "demo";
  const [teams, invoices, claims, adjustments, history, exclusions, customers, matches] = await Promise.all([
    db.query.teams.findMany({ where: eq(schema.teams.campaignId, campaign.id) }),
    db
      .select()
      .from(schema.invoices)
      .where(and(gte(schema.invoices.date, campaign.startDate), lte(schema.invoices.date, campaign.endDate))),
    db.query.claims.findMany({ where: eq(schema.claims.campaignId, campaign.id) }),
    db.query.adjustments.findMany({ where: eq(schema.adjustments.campaignId, campaign.id) }),
    db.query.doctorHistory.findMany({ where: eq(schema.doctorHistory.campaignId, campaign.id) }),
    db.query.exclusions.findMany({ where: eq(schema.exclusions.campaignId, campaign.id) }),
    db.query.customerHistory.findMany({ where: eq(schema.customerHistory.campaignId, campaign.id) }),
    db.select().from(schema.doctorMatches),
  ]);

  const result = computeScores({
    ruleset,
    period: { start: campaign.startDate, end: campaign.endDate },
    teams,
    invoices: invoices.filter((i) => i.id.startsWith("demo-") === isDemo && (!asOf || i.date <= asOf)),
    claims: asOf ? claims.filter((c) => c.date <= asOf) : claims,
    adjustments,
    doctorHistory: new Map(history.map((h) => [h.doctorKey, h.lastInvoiceDate])),
    doctorHistoryMeta: new Map(history.map((h) => [h.doctorKey, { lastNumber: h.lastInvoiceNumber, checkedBefore: h.checkedBefore, matchedName: h.matchedName, confidence: h.matchConfidence }])),
    excludedInvoiceIds: new Set(exclusions.map((e) => e.invoiceId)),
    // Rows saved before candidates existed still count via their single best match.
    doctorCandidates: new Map(
      history.map((h) => [
        h.doctorKey,
        h.candidates.length
          ? h.candidates
          : h.lastInvoiceDate
            ? [{
                name: h.matchedName ?? h.doctorName,
                key: h.matchedName ? doctorNameKey(h.matchedName) : h.doctorKey,
                date: h.lastInvoiceDate,
                number: h.lastInvoiceNumber ?? "",
                confidence: (h.matchConfidence ?? "exact") as "exact" | "same" | "possible",
              }]
            : [],
      ]),
    ),
    doctorMatches: matches.map((m) => ({ keyA: m.keyA, keyB: m.keyB, level: m.level, decision: m.decision })),
    customerHistory: new Map(
      customers.map((c) => [c.customerId, { lastDate: c.lastInvoiceDate, lastNumber: c.lastInvoiceNumber, checkedBefore: c.checkedBefore }]),
    ),
  });
  return { ruleset, result };
}
