/**
 * Doctors on October focus-product invoices (STC / B&B / URO / MD Telesales)
 * with NO Zoho invoice in the 6 months before their first October order.
 * Uses the same name-variant-aware lookup as the leaderboard sync.
 *   npm run report:new-doctors
 * Writes reports/new-doctors-<date>.csv
 */
import fs from "node:fs";
import { and, eq, gte, lte } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import { parseRuleset } from "../src/lib/rules/schema";
import { addMonths, doctorKey } from "../src/lib/rules/engine";
import { sourceFor, type DoctorHistoryHit } from "../src/lib/zoho/source";

const START = "2026-10-01";
const END = "2026-10-31";
const SALESPERSON = /^(STC|B&B|URO|MD\s*Telesales)\b/i;

async function main() {
  const campaign = await db.query.campaigns.findFirst({ where: eq(schema.campaigns.slug, "rise-3") });
  if (!campaign) throw new Error("rise-3 campaign not found");
  const rs = parseRuleset(campaign.ruleset);
  const zoho = sourceFor("zoho");
  const groupOf = new Map<string, string>();
  for (const g of rs.productGroups) for (const p of g.products) {
    if (p.itemId) groupOf.set(p.itemId, g.name);
    groupOf.set(p.name.toLowerCase(), g.name);
  }
  const excluded = new Set(rs.zoho.excludedStatuses);

  const invoices = (await db.select().from(schema.invoices).where(and(gte(schema.invoices.date, START), lte(schema.invoices.date, END))))
    .filter((i) => !i.id.startsWith("demo-") && !excluded.has(i.status) && SALESPERSON.test(i.salespersonName.trim()))
    .sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));

  const doctors = new Map<string, { names: Set<string>; first: string; invoices: typeof invoices }>();
  for (const inv of invoices) {
    const key = doctorKey(inv.doctorName, rs.zoho.blankDoctorValues);
    if (!key) continue;
    const d = doctors.get(key) ?? { names: new Set<string>(), first: inv.date, invoices: [] };
    d.names.add(inv.doctorName.trim());
    d.invoices.push(inv);
    doctors.set(key, d);
  }
  console.error(`${invoices.length} October focus invoices in scope · ${doctors.size} distinct doctors · checking Zoho history…`);

  const csv: string[][] = [];
  const result: { verdict: string; doctor: string; salesperson: string; products: string; value: number; basis: string }[] = [];
  for (const d of doctors.values()) {
    let last: DoctorHistoryHit | null = null;
    for (const name of d.names) {
      const hit = await zoho.lastDoctorInvoiceBefore(name, d.first, rs.zoho);
      if (hit && (!last || hit.date > last.date || (last.confidence === "possible" && hit.confidence !== "possible"))) last = hit;
    }
    const cutoff = addMonths(d.first, -6);
    const within = !!last && last.date > cutoff;
    const verdict = !within
      ? "FIRST TIME IN 6 MONTHS"
      : last!.confidence === "possible"
        ? "POSSIBLE MATCH — verify"
        : "SEEN WITHIN 6 MONTHS";
    if (verdict === "SEEN WITHIN 6 MONTHS") continue;
    const basis = !last
      ? "No earlier invoice for this doctor in Zoho"
      : `Last invoice ${last.number} on ${last.date} as "${last.matchedName}"${last.confidence === "possible" ? " (surname only)" : ""}`;

    const lines = d.invoices.flatMap((inv) =>
      inv.lines.filter((l) => groupOf.has(l.itemId) || groupOf.has(l.name.toLowerCase())).map((l) => ({ inv, l })),
    );
    for (const { inv, l } of lines) {
      csv.push([[...d.names][0], verdict, basis, inv.salespersonName, inv.number, inv.date, l.name, groupOf.get(l.itemId) ?? groupOf.get(l.name.toLowerCase()) ?? "", l.amount.toFixed(2)]);
    }
    result.push({
      verdict,
      doctor: [...d.names][0],
      salesperson: [...new Set(d.invoices.map((i) => i.salespersonName))].join(", "),
      products: lines.map(({ l }) => l.name).join(" + "),
      value: lines.reduce((s, { l }) => s + l.amount, 0),
      basis,
    });
  }
  result.sort((a, b) => a.verdict.localeCompare(b.verdict) || b.value - a.value);
  console.log(JSON.stringify({ inScopeInvoices: invoices.length, doctorsChecked: doctors.size, result }, null, 1));

  fs.mkdirSync("reports", { recursive: true });
  const file = `reports/new-doctors-${new Date().toISOString().slice(0, 10)}.csv`;
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const header = ["Doctor", "Verdict", "Basis", "Salesperson", "Invoice", "Date", "Product", "Group", "Value (PHP)"];
  fs.writeFileSync(file, [header, ...csv].map((r) => r.map(esc).join(",")).join("\n"));
  console.error(`CSV written to ${file}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
