import type { Award, ProductGroup, Rule, Ruleset } from "./schema";
import { doctorNameKey, pairId } from "./doctor-match";

/**
 * Pure scoring engine. Given a ruleset and the raw facts (invoices, claims,
 * adjustments, doctor history) it returns every scoring event plus per-team
 * totals and award standings. No I/O — the leaderboard is always recomputed
 * from source data, so editing a rule immediately re-scores everything.
 */

export type InvoiceLine = { itemId: string; name: string; amount: number };

export type InvoiceFact = {
  id: string;
  number: string;
  date: string; // YYYY-MM-DD
  status: string;
  customerId: string;
  customerName: string;
  salespersonId: string;
  salespersonName: string;
  doctorName: string;
  source: string;
  total: number;
  lines: InvoiceLine[];
};

export type TeamFact = {
  id: string;
  name: string;
  chcName: string;
  mdName: string;
  region?: string;
  salespersonIds: string[];
};

export type ClaimFact = {
  id: string;
  teamId: string;
  ruleId: string;
  date: string;
  entityName: string;
  groupId: string;
  status: "pending" | "approved" | "rejected";
  evidence?: string;
};

export type AdjustmentFact = {
  id: string;
  teamId: string;
  missionId: string | null;
  points: number;
  reason: string;
};

/**
 * doctorKey -> the most recent invoice date strictly before the doctor's
 * first focus order in the campaign; null = no invoice ever.
 * A missing key means history hasn't been fetched yet.
 */
export type DoctorHistory = Map<string, string | null>;

export type ScoreInput = {
  ruleset: Ruleset;
  period: { start: string; end: string };
  teams: TeamFact[];
  invoices: InvoiceFact[];
  claims: ClaimFact[];
  adjustments: AdjustmentFact[];
  doctorHistory: DoctorHistory;
  /** Optional details for the evidence trail (invoice number, lookup cut-off). */
  doctorHistoryMeta?: Map<string, { lastNumber: string | null; checkedBefore: string; matchedName?: string | null; confidence?: string | null }>;
  excludedInvoiceIds: Set<string>;
  /**
   * customerId -> most recent invoice strictly before the customer's first qualifying order
   * (null = none). Missing key = not fetched yet. Used by per_order rules with newCustomerMonths.
   */
  customerHistory?: Map<string, { lastDate: string | null; lastNumber: string | null; checkedBefore: string }>;
  /** doctorKey -> every earlier-invoice match found in Zoho (exact + spelling variants). */
  doctorCandidates?: Map<string, DoctorCandidateFact[]>;
  /** Suggested same-doctor pairs and the admin's verdict on each. */
  doctorMatches?: DoctorMatchFact[];
};

export type DoctorCandidateFact = { name: string; key: string; date: string; number: string; confidence: "exact" | "same" | "possible"; reason?: string };
export type DoctorMatchFact = { keyA: string; keyB: string; level: "same" | "possible"; decision: "pending" | "same" | "different" };

/** The Zoho invoice data a point was computed from. */
export type OrderBasis = {
  id: string;
  number: string;
  date: string;
  status: string;
  source: string;
  salesperson: string;
  doctor: string | null;
  customer: string;
  focusLines: { name: string; groupId: string; group: string; amount: number }[];
  focusTotal: number;
  total: number;
  group: string;
};

export type EventBasis = {
  invoices?: OrderBasis[];
  history?: {
    lastDate: string | null;
    lastNumber: string | null;
    checkedBefore: string;
    gapMonths?: number;
    matchedName?: string | null;
    confidence?: string | null;
    /** The decision rests on an unreviewed "possible" name match. */
    pendingReview?: boolean;
    /** Other spellings merged into this doctor for the campaign. */
    aliases?: string[];
  };
  /** Customer (hospital) look-back for "new customer" rules. */
  customerHistory?: { lastDate: string | null; lastNumber: string | null; checkedBefore: string; months: number };
  related?: { number: string; date: string }[];
  claim?: { entity: string; evidence: string; group: string };
  /** The customer is the subject of the rule (e.g. a hospital), not a patient. */
  showCustomer?: boolean;
};

export type ScoreEvent = {
  teamId: string;
  ruleId: string; // "adjustment" for manual adjustments
  missionId: string | null;
  points: number;
  date: string;
  label: string;
  detail: string;
  /** Human-readable formula, e.g. "₱25,500 ÷ ₱1,000 = 25 × 1 pt = 25 pts". */
  calc: string;
  basis: EventBasis;
  groupId?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  doctorName?: string;
  customerName?: string;
  claimId?: string;
};

export type TeamScore = {
  team: TeamFact;
  rank: number;
  total: number;
  byMission: Record<string, number>;
  byRule: Record<string, { points: number; count: number }>;
  focusSales: number;
  groupSales: Record<string, number>;
  maxSingleOrder: number;
  orders: number;
};

export type AwardStanding = {
  award: Award;
  leaders: { teamId: string; value: number }[];
  winnerTeamId: string | null;
  note?: string;
};

export type ScoreResult = {
  teams: TeamScore[];
  events: ScoreEvent[];
  awards: AwardStanding[];
  warnings: {
    unmappedSalespersons: { id: string; name: string; invoices: number; focusSales: number }[];
    doctorsMissingHistory: string[];
    customersMissingHistory: string[];
    /** Doctors whose New/Comeback result depends on a name match nobody has reviewed yet. */
    doctorsPendingReview: string[];
    skippedInvoices: number;
  };
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function doctorKey(name: string, blankValues: string[]): string | null {
  const cleaned = name.toLowerCase().replace(/\s+/g, " ").trim();
  if (blankValues.map((v) => v.toLowerCase()).includes(cleaned)) return null;
  // Title-, credential-, accent- and order-insensitive ("Roxan A. Perez, M.D." = "Dr. Roxan A. Perez").
  return doctorNameKey(name) || null;
}

export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

type PreparedOrder = {
  inv: InvoiceFact;
  teamId: string;
  doctorKey: string | null;
  groupId: string; // highest-ranked focus group in the order
  groupSales: Record<string, number>;
  focusTotal: number;
  focusLines: OrderBasis["focusLines"];
};

/** Whole calendar months between two YYYY-MM-DD dates. */
export function monthsBetween(from: string, to: string) {
  let m = 0;
  while (addMonths(from, m + 1) <= to) m++;
  return m;
}

function buildProductMatcher(groups: ProductGroup[]) {
  const byId = new Map<string, ProductGroup>();
  const byName = new Map<string, ProductGroup>();
  for (const g of groups) {
    for (const p of g.products) {
      if (p.itemId) byId.set(p.itemId, g);
      byName.set(p.name.trim().toLowerCase(), g);
    }
  }
  return (line: InvoiceLine) => byId.get(line.itemId) ?? byName.get(line.name.trim().toLowerCase()) ?? null;
}

function passesSource(rule: Rule, source: string) {
  if (!rule.sourceFilter.length) return true;
  const s = source.trim().toLowerCase();
  return rule.sourceFilter.some((f) => f.trim().toLowerCase() === s);
}

export function computeScores(input: ScoreInput): ScoreResult {
  const { ruleset, period, teams } = input;
  const zoho = ruleset.zoho;
  const groupRank = new Map(ruleset.productGroups.map((g) => [g.id, g.rank]));
  const groupName = new Map(ruleset.productGroups.map((g) => [g.id, g.name]));
  const matchProduct = buildProductMatcher(ruleset.productGroups);

  const teamBySalesperson = new Map<string, string>();
  for (const t of teams) for (const sp of t.salespersonIds) teamBySalesperson.set(sp, t.id);

  const unmapped = new Map<string, { id: string; name: string; invoices: number; focusSales: number }>();
  let skipped = 0;

  // ---- 1. Prepare qualifying orders -------------------------------------
  const orders: PreparedOrder[] = [];
  const excludedStatuses = new Set(zoho.excludedStatuses.map((s) => s.toLowerCase()));
  const sortedInvoices = [...input.invoices].sort(
    (a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number),
  );

  for (const inv of sortedInvoices) {
    if (inv.date < period.start || inv.date > period.end) continue;
    if (excludedStatuses.has(inv.status.toLowerCase()) || input.excludedInvoiceIds.has(inv.id)) {
      skipped++;
      continue;
    }
    const groupSales: Record<string, number> = {};
    const focusLines: OrderBasis["focusLines"] = [];
    for (const line of inv.lines) {
      const g = matchProduct(line);
      if (!g) continue;
      groupSales[g.id] = (groupSales[g.id] ?? 0) + line.amount;
      focusLines.push({ name: line.name, groupId: g.id, group: g.name, amount: line.amount });
    }
    const groupIds = Object.keys(groupSales);
    if (!groupIds.length) continue;
    const focusTotal = round2(Object.values(groupSales).reduce((a, b) => a + b, 0));

    const teamId = teamBySalesperson.get(inv.salespersonId);
    if (!teamId) {
      const u = unmapped.get(inv.salespersonId) ?? {
        id: inv.salespersonId,
        name: inv.salespersonName,
        invoices: 0,
        focusSales: 0,
      };
      u.invoices++;
      u.focusSales = round2(u.focusSales + focusTotal);
      unmapped.set(inv.salespersonId, u);
      continue;
    }
    const groupId = groupIds.sort((a, b) => (groupRank.get(a) ?? 99) - (groupRank.get(b) ?? 99))[0];
    orders.push({
      inv,
      teamId,
      doctorKey: doctorKey(inv.doctorName, zoho.blankDoctorValues),
      groupId,
      groupSales,
      focusTotal,
      focusLines,
    });
  }

  // ---- 1b. Merge doctor spellings that are the same person ---------------
  // Confirmed "same" pairs always merge; auto "same" pairs merge unless an admin said "different".
  const decisionOf = new Map((input.doctorMatches ?? []).map((m) => [pairId(m.keyA, m.keyB), m]));
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const firstDateOfKey = new Map<string, string>();
  for (const o of orders) if (o.doctorKey && !firstDateOfKey.has(o.doctorKey)) firstDateOfKey.set(o.doctorKey, o.inv.date);
  for (const m of input.doctorMatches ?? []) {
    const merge = m.decision === "same" || (m.decision === "pending" && m.level === "same");
    if (!merge || !firstDateOfKey.has(m.keyA) || !firstDateOfKey.has(m.keyB)) continue;
    const [ra, rb] = [find(m.keyA), find(m.keyB)];
    if (ra === rb) continue;
    // The spelling that ordered first becomes the group's key.
    const aFirst = (firstDateOfKey.get(ra) ?? "") <= (firstDateOfKey.get(rb) ?? "");
    parent.set(aFirst ? rb : ra, aFirst ? ra : rb);
  }
  const members = new Map<string, Set<string>>();
  const namesOfKey = new Map<string, Set<string>>();
  for (const o of orders) {
    if (!o.doctorKey) continue;
    const root = find(o.doctorKey);
    (members.get(root) ?? members.set(root, new Set()).get(root)!).add(o.doctorKey);
    (namesOfKey.get(root) ?? namesOfKey.set(root, new Set()).get(root)!).add(o.inv.doctorName.trim());
    o.doctorKey = root;
  }
  const pendingReview = new Set<string>();

  /** Most recent earlier invoice for a (merged) doctor, honouring admin decisions. undefined = not fetched yet. */
  const doctorLast = (root: string, firstDate: string) => {
    const keys = [...(members.get(root) ?? [root])];
    if (!input.doctorCandidates) {
      if (!input.doctorHistory.has(root)) return undefined;
      const meta = input.doctorHistoryMeta?.get(root);
      return {
        lastDate: input.doctorHistory.get(root) ?? null,
        lastNumber: meta?.lastNumber ?? null,
        checkedBefore: meta?.checkedBefore ?? firstDate,
        matchedName: meta?.matchedName ?? null,
        confidence: meta?.confidence ?? null,
        pendingReview: false,
      };
    }
    if (!keys.some((k) => input.doctorHistory.has(k))) return undefined;
    let best: (DoctorCandidateFact & { pending: boolean }) | null = null;
    for (const k of keys) {
      for (const c of input.doctorCandidates.get(k) ?? []) {
        if (c.date >= firstDate) continue; // the doctor's own campaign orders don't count as history
        let pending = false;
        if (c.confidence !== "exact" && !keys.includes(c.key)) {
          const verdicts = keys.map((m) => decisionOf.get(pairId(m, c.key))).filter(Boolean);
          if (verdicts.some((v) => v!.decision === "different")) continue;
          pending = c.confidence === "possible" && !verdicts.some((v) => v!.decision === "same");
        }
        if (!best || c.date > best.date) best = { ...c, pending };
      }
    }
    const meta = input.doctorHistoryMeta?.get(root);
    return {
      lastDate: best?.date ?? null,
      lastNumber: best?.number ?? null,
      checkedBefore: meta?.checkedBefore ?? firstDate,
      matchedName: best?.name ?? null,
      confidence: best?.confidence ?? null,
      pendingReview: !!best?.pending,
    };
  };

  // ---- 2. Apply rules ---------------------------------------------------
  const events: ScoreEvent[] = [];
  const missingHistory = new Set<string>();
  const missingCustomers = new Set<string>();
  const firstDateOfDoctor = new Map<string, string>();
  for (const o of orders) if (o.doctorKey && !firstDateOfDoctor.has(o.doctorKey)) firstDateOfDoctor.set(o.doctorKey, o.inv.date);
  const firstOrderOfCustomer = new Map<string, string>();
  for (const o of orders) if (!firstOrderOfCustomer.has(o.inv.customerId)) firstOrderOfCustomer.set(o.inv.customerId, o.inv.id);
  const peso = (n: number) => `₱${round2(n).toLocaleString("en-PH")}`;
  const gname = (gid: string) => groupName.get(gid) ?? gid;
  const orderBasis = (o: PreparedOrder): OrderBasis => ({
    id: o.inv.id,
    number: o.inv.number,
    date: o.inv.date,
    status: o.inv.status,
    source: o.inv.source,
    salesperson: o.inv.salespersonName,
    doctor: o.doctorKey ? o.inv.doctorName : null,
    customer: o.inv.customerName,
    focusLines: o.focusLines,
    focusTotal: o.focusTotal,
    total: o.inv.total,
    group: gname(o.groupId),
  });
  const orderEvent = (rule: Rule, o: PreparedOrder, points: number, detail: string, calc: string, extra: Partial<EventBasis> = {}): ScoreEvent => ({
    teamId: o.teamId,
    ruleId: rule.id,
    missionId: rule.missionId,
    points,
    date: o.inv.date,
    label: rule.label,
    detail,
    calc,
    basis: { invoices: [orderBasis(o)], ...extra },
    groupId: o.groupId,
    invoiceId: o.inv.id,
    invoiceNumber: o.inv.number,
    doctorName: o.doctorKey ? o.inv.doctorName : undefined,
    customerName: o.inv.customerName,
  });

  for (const rule of ruleset.rules) {
    if (!rule.enabled) continue;
    const eligible = orders.filter((o) => passesSource(rule, o.inv.source));
    const sourceNote = rule.sourceFilter.length ? ` (Source: ${rule.sourceFilter.join(" / ")})` : "";

    switch (rule.type) {
      case "sales_rate": {
        if (rule.aggregation === "per_invoice") {
          for (const o of eligible) {
            for (const [gid, amount] of Object.entries(o.groupSales)) {
              const rate = rule.rates[gid];
              if (!rate) continue;
              const units = Math.floor(amount / rate.per);
              const pts = units * rate.points;
              if (pts) {
                events.push({
                  ...orderEvent(rule, o, pts, `${gname(gid)} sales ${peso(amount)}`, `${gname(gid)} ${peso(amount)} ÷ ${peso(rate.per)} = ${units} × ${rate.points} pt = ${pts} pts (rounded down)`),
                  groupId: gid,
                });
              }
            }
          }
        } else {
          const totals = new Map<string, { amount: number; lastDate: string; orders: PreparedOrder[] }>();
          for (const o of eligible) {
            for (const [gid, amount] of Object.entries(o.groupSales)) {
              const key = `${o.teamId}|${gid}`;
              const t = totals.get(key) ?? { amount: 0, lastDate: o.inv.date, orders: [] };
              t.amount += amount;
              t.lastDate = o.inv.date > t.lastDate ? o.inv.date : t.lastDate;
              t.orders.push(o);
              totals.set(key, t);
            }
          }
          for (const [key, t] of totals) {
            const [teamId, gid] = key.split("|");
            const rate = rule.rates[gid];
            if (!rate) continue;
            const units = Math.floor(t.amount / rate.per);
            const pts = units * rate.points;
            events.push({
              teamId,
              ruleId: rule.id,
              missionId: rule.missionId,
              points: pts,
              date: t.lastDate,
              label: rule.label,
              detail: `${gname(gid)}: ${peso(t.amount)} across ${t.orders.length} order(s) @ ${rate.points} pt / ${peso(rate.per)}`,
              calc: `${gname(gid)} sales ${peso(t.amount)} ÷ ${peso(rate.per)} = ${units} × ${rate.points} pt = ${pts} pts (team total, rounded down)`,
              basis: {
                invoices: t.orders.map((o) => ({
                  ...orderBasis(o),
                  focusLines: o.focusLines.filter((l) => l.groupId === gid),
                  focusTotal: round2(o.groupSales[gid]),
                })),
              },
              groupId: gid,
            });
          }
        }
        break;
      }

      case "doctor_new":
      case "doctor_reactivation": {
        const seen = new Set<string>();
        for (const o of eligible) {
          if (!o.doctorKey || seen.has(o.doctorKey)) continue;
          seen.add(o.doctorKey); // only the doctor's first qualifying order in the campaign
          const found = doctorLast(o.doctorKey, firstDateOfDoctor.get(o.doctorKey) ?? o.inv.date);
          if (!found) {
            missingHistory.add(o.inv.doctorName);
            continue;
          }
          const last = found.lastDate;
          const aliases = [...(namesOfKey.get(o.doctorKey) ?? [])].filter((n) => n !== o.inv.doctorName.trim());
          const history = { ...found, aliases: aliases.length ? aliases : undefined };
          if (found.pendingReview) pendingReview.add(o.inv.doctorName);
          const pts = rule.points[o.groupId] ?? 0;
          if (!pts) continue;
          if (rule.type === "doctor_new" && last === null) {
            events.push(
              orderEvent(
                rule, o, pts,
                `First-ever invoice for Dr. ${o.inv.doctorName}`,
                `No Zoho invoice for this doctor before ${history.checkedBefore} → New Doctor, ${gname(o.groupId)} = ${pts} pts`,
                { history },
              ),
            );
          }
          if (rule.type === "doctor_reactivation" && last !== null && addMonths(last, rule.minMonthsGap) <= o.inv.date) {
            const gap = monthsBetween(last, o.inv.date);
            events.push(
              orderEvent(
                rule, o, pts,
                `Dr. ${o.inv.doctorName} — last invoice ${last}`,
                `Last Zoho invoice${history.lastNumber ? ` ${history.lastNumber}` : ""} on ${last}, ${gap} months before this order (needs ≥ ${rule.minMonthsGap}) → ${gname(o.groupId)} = ${pts} pts`,
                { history: { ...history, gapMonths: gap } },
              ),
            );
          }
        }
        break;
      }

      case "repeat_order": {
        const seenOrders = new Map<string, PreparedOrder[]>();
        for (const o of eligible) {
          const entity = rule.entity === "doctor" ? o.doctorKey : o.inv.customerId;
          if (!entity) continue;
          const key = `${entity}|${o.inv.date.slice(0, 7)}`;
          const earlier = seenOrders.get(key) ?? [];
          const n = earlier.length + 1;
          seenOrders.set(key, [...earlier, o]);
          const hit = rule.includeAfterNth ? n >= rule.nth : n === rule.nth;
          const pts = rule.points[o.groupId] ?? 0;
          if (hit && pts) {
            const who = rule.entity === "doctor" ? `Dr. ${o.inv.doctorName}` : o.inv.customerName;
            const month = new Date(`${o.inv.date}T00:00:00Z`).toLocaleDateString("en-PH", { month: "long", timeZone: "UTC" });
            events.push(
              orderEvent(
                rule, o, pts,
                `Order #${n} this month from ${who}`,
                `Order #${n} from the same ${rule.entity === "doctor" ? "doctor" : "customer"} in ${month}${sourceNote} → ${pts} pts`,
                { related: earlier.map((e) => ({ number: e.inv.number, date: e.inv.date })), showCustomer: rule.entity === "customer" },
              ),
            );
          }
        }
        break;
      }

      case "per_order": {
        for (const o of eligible) {
          const pts = rule.points[o.groupId] ?? 0;
          if (!pts) continue;
          const extra: Partial<EventBasis> = { showCustomer: true };
          let newNote = "";
          if (rule.newCustomerMonths) {
            // Only the customer's earliest order in the campaign (any source) can be "new":
            // every later order has that earlier one inside the look-back window.
            if (firstOrderOfCustomer.get(o.inv.customerId) !== o.inv.id) continue;
            const h = input.customerHistory?.get(o.inv.customerId);
            if (!h) {
              missingCustomers.add(o.inv.customerName);
              continue;
            }
            if (h.lastDate && addMonths(h.lastDate, rule.newCustomerMonths) > o.inv.date) continue; // invoiced within the window
            extra.customerHistory = { ...h, months: rule.newCustomerMonths };
            newNote = h.lastDate
              ? `; last invoice to this customer ${h.lastNumber ?? ""} on ${h.lastDate} (≥ ${rule.newCustomerMonths} months ago)`
              : `; no earlier invoice to this customer in Zoho`;
          }
          events.push(
            orderEvent(
              rule, o, pts,
              `${o.inv.source || "Order"} — ${o.inv.customerName}`,
              `Zoho Source = "${o.inv.source || "—"}", ${gname(o.groupId)} order${newNote} → ${pts} pts`,
              extra,
            ),
          );
        }
        break;
      }

      case "order_threshold": {
        for (const o of eligible) {
          if (rule.requireDoctor && !o.doctorKey) continue;
          const amount = rule.basis === "focus_products" ? o.focusTotal : o.inv.total;
          if (amount >= rule.minAmount) {
            events.push(
              orderEvent(
                rule, o, rule.points,
                `Single order ${peso(amount)} ≥ ${peso(rule.minAmount)}`,
                `${rule.basis === "focus_products" ? "Focus products" : "Invoice total"} ${peso(amount)} on one invoice ≥ ${peso(rule.minAmount)}${rule.requireDoctor ? ", with a doctor" : ""} → +${rule.points} pts`,
              ),
            );
          }
        }
        break;
      }

      case "manual_claim": {
        for (const c of input.claims) {
          if (c.ruleId !== rule.id || c.status !== "approved") continue;
          if (c.date < period.start || c.date > period.end) continue;
          const pts = rule.points[c.groupId] ?? 0;
          if (!pts) continue;
          events.push({
            teamId: c.teamId,
            ruleId: rule.id,
            missionId: rule.missionId,
            points: pts,
            date: c.date,
            label: rule.label,
            detail: `${c.entityName} (${gname(c.groupId)})`,
            calc: `Management-approved claim for ${c.entityName}, ${gname(c.groupId)} → ${pts} pts`,
            basis: { claim: { entity: c.entityName, evidence: c.evidence ?? "", group: gname(c.groupId) } },
            groupId: c.groupId,
            claimId: c.id,
            customerName: c.entityName,
          });
        }
        break;
      }
    }
  }

  for (const a of input.adjustments) {
    events.push({
      teamId: a.teamId,
      ruleId: "adjustment",
      missionId: a.missionId,
      points: a.points,
      date: period.end,
      label: "Management adjustment",
      detail: a.reason,
      calc: `Correction by management: ${a.points > 0 ? "+" : ""}${a.points} pts — ${a.reason}`,
      basis: {},
    });
  }

  // ---- 3. Aggregate -----------------------------------------------------
  const scores = new Map<string, TeamScore>();
  for (const t of teams) {
    scores.set(t.id, {
      team: t,
      rank: 0,
      total: 0,
      byMission: Object.fromEntries(ruleset.missions.map((m) => [m.id, 0])),
      byRule: {},
      focusSales: 0,
      groupSales: {},
      maxSingleOrder: 0,
      orders: 0,
    });
  }
  for (const o of orders) {
    const s = scores.get(o.teamId)!;
    s.orders++;
    s.focusSales = round2(s.focusSales + o.focusTotal);
    for (const [gid, amt] of Object.entries(o.groupSales)) s.groupSales[gid] = round2((s.groupSales[gid] ?? 0) + amt);
    if (o.doctorKey) s.maxSingleOrder = Math.max(s.maxSingleOrder, o.focusTotal);
  }
  for (const e of events) {
    const s = scores.get(e.teamId);
    if (!s) continue;
    s.total += e.points;
    if (e.missionId) s.byMission[e.missionId] = (s.byMission[e.missionId] ?? 0) + e.points;
    const r = (s.byRule[e.ruleId] ??= { points: 0, count: 0 });
    r.points += e.points;
    r.count++;
  }

  const ranked = [...scores.values()].sort(
    (a, b) => b.total - a.total || b.focusSales - a.focusSales || a.team.name.localeCompare(b.team.name),
  );
  ranked.forEach((s, i) => {
    s.rank = i > 0 && s.total === ranked[i - 1].total && s.focusSales === ranked[i - 1].focusSales ? ranked[i - 1].rank : i + 1;
  });

  events.sort((a, b) => b.date.localeCompare(a.date));

  return {
    teams: ranked,
    events,
    awards: computeAwards(ruleset.awards, ranked),
    warnings: {
      unmappedSalespersons: [...unmapped.values()].sort((a, b) => b.focusSales - a.focusSales),
      doctorsMissingHistory: [...missingHistory],
      customersMissingHistory: [...missingCustomers],
      doctorsPendingReview: [...pendingReview],
      skippedInvoices: skipped,
    },
  };
}

function computeAwards(awards: Award[], ranked: TeamScore[]): AwardStanding[] {
  const overallWinners = new Set<string>();
  const rewardedMds = new Map<string, string>(); // md name -> award title
  const out: AwardStanding[] = [];

  // Overall placings first so special awards can exclude them.
  const ordered = [...awards].sort((a, b) => (a.basis.kind === "overall_rank" ? 0 : 1) - (b.basis.kind === "overall_rank" ? 0 : 1));

  for (const award of ordered) {
    let leaders: { teamId: string; value: number }[];
    const b = award.basis;
    if (b.kind === "overall_rank") {
      const t = ranked[b.place - 1];
      leaders = t && t.total > 0 ? [{ teamId: t.team.id, value: t.total }] : [];
    } else {
      const valueOf = (s: TeamScore) =>
        b.kind === "mission_points" ? s.byMission[b.missionId] ?? 0
        : b.kind === "rule_points" ? s.byRule[b.ruleId]?.points ?? 0
        : s.maxSingleOrder;
      leaders = ranked
        .filter((s) => !(award.excludeOverallWinners && overallWinners.has(s.team.id)))
        .map((s) => ({ teamId: s.team.id, value: valueOf(s) }))
        .filter((l) => l.value > 0)
        .sort((x, y) => y.value - x.value)
        .slice(0, 5);
    }
    const winnerTeamId = leaders[0]?.teamId ?? null;
    let note: string | undefined;
    if (winnerTeamId) {
      if (b.kind === "overall_rank") overallWinners.add(winnerTeamId);
      const md = ranked.find((s) => s.team.id === winnerTeamId)?.team.mdName.trim();
      if (md) {
        const prior = rewardedMds.get(md.toLowerCase());
        if (prior) note = `MD partner ${md} already rewarded via ${prior} — eligible for one reward only.`;
        else rewardedMds.set(md.toLowerCase(), award.title);
      }
    }
    out.push({ award, leaders, winnerTeamId, note });
  }
  // restore configured order
  return awards.map((a) => out.find((o) => o.award.id === a.id)!);
}
