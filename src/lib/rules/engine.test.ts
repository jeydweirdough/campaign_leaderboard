import { test } from "node:test";
import assert from "node:assert/strict";
import { computeScores, addMonths, type InvoiceFact, type ScoreInput } from "./engine";
import { RISE_3_RULESET } from "./presets";

// Scenarios from §12 "Quick Examples" of the RISE 3.0 SOP.

const PAZO = { itemId: "2254168001994779289", name: "PazoGet 400mg" }; // Top 5
const SORA = { itemId: "2254168001985754025", name: "SoraGet 200mg" }; // Other 5
const team = { id: "t1", name: "Team 1", chcName: "CHC", mdName: "MD", salespersonIds: ["sp1"] };

let n = 0;
function inv(p: Partial<InvoiceFact> & { lines: InvoiceFact["lines"] }): InvoiceFact {
  n++;
  return {
    id: `i${n}`, number: `INV-${n}`, date: "2026-10-10", status: "paid", customerId: `c${n}`, customerName: `Cust ${n}`,
    salespersonId: "sp1", salespersonName: "SP", doctorName: "Dr. Maria Santos", source: "Doctor order",
    total: p.lines.reduce((a, l) => a + l.amount, 0), ...p,
  };
}

function run(invoices: InvoiceFact[], history: [string, string | null][] = [], extra: Partial<ScoreInput> = {}) {
  return computeScores({
    ruleset: RISE_3_RULESET, period: { start: "2026-10-01", end: "2026-10-31" }, teams: [team], invoices,
    claims: [], adjustments: [], doctorHistory: new Map(history), excludedInvoiceIds: new Set(), ...extra,
  });
}
const pts = (r: ReturnType<typeof run>, ruleId: string) => r.teams[0].byRule[ruleId]?.points ?? 0;

test("product power: 1pt/₱1,000 Top 5, 1pt/₱2,000 Other 5", () => {
  const r = run([inv({ lines: [{ ...PAZO, amount: 25_500 }, { ...SORA, amount: 9_000 }] })], [["maria santos", "2026-09-01"]]);
  assert.equal(pts(r, "product-power"), 25 + 4);
});

test("no invoice ever + qualifying October order => New Doctor 10 (Top 5) + product points", () => {
  const r = run([inv({ lines: [{ ...PAZO, amount: 5_000 }] })], [["maria santos", null]]);
  assert.equal(pts(r, "new-doctor"), 10);
  assert.equal(pts(r, "product-power"), 5);
});

test("New Doctor with Other-5-only order => 6", () => {
  const r = run([inv({ lines: [{ ...SORA, amount: 5_000 }] })], [["maria santos", null]]);
  assert.equal(pts(r, "new-doctor"), 6);
});

test("last invoice 7 months before => Reactivation", () => {
  const r = run([inv({ lines: [{ ...PAZO, amount: 5_000 }] })], [["maria santos", "2026-03-01"]]);
  assert.equal(pts(r, "reactivation"), 10);
  assert.equal(pts(r, "new-doctor"), 0);
});

test("last invoice 5 months before => no Reactivation", () => {
  const r = run([inv({ lines: [{ ...PAZO, amount: 5_000 }] })], [["maria santos", "2026-05-15"]]);
  assert.equal(pts(r, "reactivation"), 0);
});

test("bought in September, one order in October => NOT a Repeat Order", () => {
  const r = run([inv({ lines: [{ ...PAZO, amount: 5_000 }] })], [["maria santos", "2026-09-20"]]);
  assert.equal(pts(r, "repeat-doctor"), 0);
});

test("two separate October orders from same doctor => second earns Repeat 5", () => {
  const r = run(
    [inv({ date: "2026-10-03", lines: [{ ...PAZO, amount: 5_000 }] }), inv({ date: "2026-10-20", doctorName: "maria santos", lines: [{ ...SORA, amount: 5_000 }] })],
    [["maria santos", "2026-09-20"]],
  );
  assert.equal(pts(r, "repeat-doctor"), 5);
  assert.equal(r.teams[0].byRule["repeat-doctor"].count, 1);
});

test("hospital: one PO in October => Hospital PO, not Repeat PO; two => Repeat PO 5", () => {
  const h = { customerId: "hosp1", customerName: "Hospital", doctorName: "NA", source: "Hospital PO" };
  const fresh = { customerHistory: new Map([["hosp1", { lastDate: null, lastNumber: null, checkedBefore: "2026-10-10" }]]) };
  const one = run([inv({ ...h, lines: [{ ...PAZO, amount: 50_000 }] })], [], fresh);
  assert.equal(pts(one, "hospital-po"), 20);
  assert.equal(pts(one, "repeat-po"), 0);
  const two = run([inv({ ...h, lines: [{ ...PAZO, amount: 50_000 }] }), inv({ ...h, source: "Emergency purchase", lines: [{ ...SORA, amount: 4_000 }] })], [], fresh);
  assert.equal(pts(two, "hospital-po"), 20);
  assert.equal(pts(two, "emergency-po"), 0, "2nd PO from the same hospital is not a new-hospital PO");
  assert.equal(pts(two, "repeat-po"), 5);
});

test("Hospital PO only counts for a hospital with no invoice in the last 6 months", () => {
  const h = { customerId: "hosp2", customerName: "Hospital 2", doctorName: "NA", source: "Hospital PO", date: "2026-10-10" };
  const hist = (lastDate: string | null) => ({ customerHistory: new Map([["hosp2", { lastDate, lastNumber: "INV-H", checkedBefore: "2026-10-10" }]]) });
  assert.equal(pts(run([inv({ ...h, lines: [{ ...PAZO, amount: 9_000 }] })], [], hist("2026-07-01")), "hospital-po"), 0, "invoiced 3 months ago");
  assert.equal(pts(run([inv({ ...h, lines: [{ ...PAZO, amount: 9_000 }] })], [], hist("2026-04-10")), "hospital-po"), 20, "exactly 6 months ago");
  assert.equal(pts(run([inv({ ...h, lines: [{ ...PAZO, amount: 9_000 }] })]), "hospital-po"), 0, "history not fetched yet → held");
  const r = run([inv({ ...h, lines: [{ ...PAZO, amount: 9_000 }] })], [], hist("2026-02-01"));
  assert.match(r.events.find((e) => e.ruleId === "hospital-po")!.calc, /last invoice to this customer INV-H on 2026-02-01/);
});

test("single doctor order ₱120,000 => normal points + Buzzer Beater 50", () => {
  const r = run([inv({ lines: [{ ...PAZO, amount: 120_000 }] })], [["maria santos", "2026-09-01"]]);
  assert.equal(pts(r, "buzzer-beater"), 50);
  assert.equal(pts(r, "product-power"), 120);
});

test("Buzzer Beater needs a doctor and focus value ≥ ₱100k", () => {
  const noDoc = run([inv({ doctorName: "NA", lines: [{ ...PAZO, amount: 150_000 }] })]);
  assert.equal(pts(noDoc, "buzzer-beater"), 0);
  const nonFocus = run([inv({ lines: [{ ...PAZO, amount: 60_000 }, { itemId: "x", name: "Other", amount: 60_000 }] })], [["maria santos", "2026-09-01"]]);
  assert.equal(pts(nonFocus, "buzzer-beater"), 0);
});

test("void invoices and management exclusions don't count", () => {
  const a = inv({ status: "void", lines: [{ ...PAZO, amount: 10_000 }] });
  const b = inv({ lines: [{ ...PAZO, amount: 10_000 }] });
  const r = run([a, b], [["maria santos", "2026-09-01"]], { excludedInvoiceIds: new Set([b.id]) });
  assert.equal(r.teams[0].total, 0);
});

test("unmapped salesperson is reported, not scored", () => {
  const r = run([inv({ salespersonId: "spX", salespersonName: "HOS | X", lines: [{ ...PAZO, amount: 10_000 }] })]);
  assert.equal(r.teams[0].total, 0);
  assert.equal(r.warnings.unmappedSalespersons[0].name, "HOS | X");
});

test("shared MD partner across winners is flagged", () => {
  const t2 = { ...team, id: "t2", name: "Team 2", salespersonIds: ["sp2"] };
  const r = run(
    [inv({ lines: [{ ...PAZO, amount: 10_000 }] }), inv({ salespersonId: "sp2", doctorName: "NA", lines: [{ ...PAZO, amount: 5_000 }] })],
    [["maria santos", "2026-09-01"]],
    { teams: [team, t2] },
  );
  const allStar = r.awards.find((a) => a.award.id === "all-star")!;
  assert.equal(allStar.winnerTeamId, "t2");
  assert.match(allStar.note ?? "", /one reward only/);
});

test("every point carries its data basis and formula", () => {
  const r = run(
    [inv({ number: "INV-R1", date: "2026-10-12", lines: [{ ...PAZO, amount: 25_500 }] })],
    [["maria santos", "2026-03-01"]],
    { doctorHistoryMeta: new Map([["maria santos", { lastNumber: "INV-OLD", checkedBefore: "2026-10-12" }]]) },
  );
  const react = r.events.find((e) => e.ruleId === "reactivation")!;
  assert.match(react.calc, /INV-OLD on 2026-03-01, 7 months/);
  assert.equal(react.basis.invoices?.[0].number, "INV-R1");
  assert.equal(react.basis.invoices?.[0].focusLines[0].group, "Top 5 Priority");
  const power = r.events.find((e) => e.ruleId === "product-power")!;
  assert.match(power.calc, /₱25,500 ÷ ₱1,000 = 25 × 1 pt = 25 pts/);
  assert.deepEqual(power.basis.invoices?.map((i) => i.number), ["INV-R1"]);
});

test("addMonths clamps to month end", () => {
  assert.equal(addMonths("2026-03-31", 6), "2026-09-30");
  assert.equal(addMonths("2026-10-15", -7), "2026-03-15");
});
