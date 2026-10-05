/**
 * Seeds two campaigns:
 *  - "RISE Challenge 3.0" — live Zoho data, October 2026, no teams yet (map them in /admin).
 *  - "Demo League" — generated sample data for September 2026 so the UI can be explored.
 * Safe to re-run: existing slugs are left untouched.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import { RISE_3_RULESET } from "../src/lib/rules/presets";
import { DEMO_SALESPERSONS, demoSource } from "../src/lib/zoho/demo";
import { doctorKey } from "../src/lib/rules/engine";

const db = drizzle(neon(process.env.DATABASE_URL!), { schema });

async function ensureCampaign(values: typeof schema.campaigns.$inferInsert) {
  const existing = await db.query.campaigns.findFirst({ where: eq(schema.campaigns.slug, values.slug) });
  if (existing) {
    console.log(`• ${values.slug} already exists — skipped`);
    return null;
  }
  await db.insert(schema.campaigns).values(values);
  console.log(`✓ created ${values.slug}`);
  return values.id;
}

async function main() {
  await ensureCampaign({
    id: crypto.randomUUID(),
    slug: "rise-3",
    name: "RISE Challenge 3.0",
    tagline: "The Rx Impact League — 10 focus products · 3 missions · 1 champion",
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    status: "live",
    dataSource: "zoho",
    ruleset: RISE_3_RULESET,
  });

  const demoId = await ensureCampaign({
    id: crypto.randomUUID(),
    slug: "demo-league",
    name: "Demo League",
    tagline: "Sample data — explore how the leaderboard works",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    status: "draft",
    dataSource: "demo",
    ruleset: RISE_3_RULESET,
  });
  if (!demoId) return;

  const people = [
    ["Team Alpha", "Andrea Cruz", "Mika Santos"],
    ["Team Bravo", "Ben Ramos", "Mika Santos"],
    ["Team Comet", "Carla Reyes", "Nico Lim"],
    ["Team Dash", "Dan Flores", "Olive Tan"],
    ["Team Echo", "Ella Garcia", "Paul Dizon"],
    ["Team Fury", "Fred Aquino", "Quin Torres"],
  ];
  const teamIds: string[] = [];
  for (const [i, sp] of DEMO_SALESPERSONS.entries()) {
    const id = crypto.randomUUID();
    teamIds.push(id);
    await db.insert(schema.teams).values({
      id, campaignId: demoId, name: people[i][0], chcName: people[i][1], mdName: people[i][2], region: sp.name.split("|")[1].trim(), salespersonIds: [sp.id],
    });
  }

  const ruleset = RISE_3_RULESET;
  const itemIds = ruleset.productGroups.flatMap((g) => g.products.map((p) => p.itemId!));
  const listed = await demoSource.listFocusInvoices(itemIds, "2026-09-01", "2026-09-30");
  const firstByDoctor = new Map<string, { date: string; name: string }>();
  for (const row of listed) {
    const inv = await demoSource.getInvoice(row.id, ruleset.zoho);
    await db.insert(schema.invoices).values(inv).onConflictDoNothing();
    const key = doctorKey(inv.doctorName, ruleset.zoho.blankDoctorValues);
    if (key && inv.status !== "void" && (!firstByDoctor.has(key) || inv.date < firstByDoctor.get(key)!.date)) {
      firstByDoctor.set(key, { date: inv.date, name: inv.doctorName });
    }
  }
  for (const [key, { date, name }] of firstByDoctor) {
    const last = await demoSource.lastDoctorInvoiceBefore(name, date, ruleset.zoho);
    await db.insert(schema.doctorHistory).values({
      campaignId: demoId, doctorKey: key, doctorName: name, checkedBefore: date, lastInvoiceDate: last?.date ?? null, lastInvoiceNumber: last?.number ?? null,
    });
  }
  await db.insert(schema.claims).values([
    { id: crypto.randomUUID(), campaignId: demoId, teamId: teamIds[2], ruleId: "hospital-inclusion", date: "2026-09-12", entityName: "Demo General Hospital", groupId: "top5", evidence: "Formulary listing letter (sample)", status: "approved" },
    { id: crypto.randomUUID(), campaignId: demoId, teamId: teamIds[0], ruleId: "hospital-inclusion", date: "2026-09-20", entityName: "Mock Cancer Institute", groupId: "other5", evidence: "Awaiting signed letter", status: "pending" },
  ]);
  await db.update(schema.campaigns).set({ lastSyncedAt: new Date().toISOString() }).where(eq(schema.campaigns.id, demoId));
  console.log(`✓ demo data: ${listed.length} invoices, ${firstByDoctor.size} doctors, ${teamIds.length} teams`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
