import "server-only";
import type { InvoiceFact } from "@/lib/rules/engine";
import { getInvoice, listInvoices, findInvoice, findItemsByName, type ZohoInvoiceDetail } from "./client";
import { compareDoctors, doctorNameKey, surnameCasings } from "@/lib/rules/doctor-match";
import { demoSource } from "./demo";

/** Where invoice facts come from. Live Zoho Books, or generated demo data. */
export type InvoiceSource = {
  /** item name -> item_id (exact, case-insensitive match) */
  resolveItemId(name: string): Promise<string | null>;
  /** Invoice ids + last-modified stamps containing any of these items in the date range. */
  listFocusInvoices(itemIds: string[], start: string, end: string): Promise<{ id: string; lastModified: string; status: string }[]>;
  getInvoice(id: string, fields: { doctorField: string; sourceField: string }): Promise<InvoiceFact & { lastModified: string }>;
  /**
   * Earlier invoices (strictly before `date`) whose doctor field is this doctor or a likely spelling
   * variant — newest per spelling. Decide which ones count with `pickLastInvoice`.
   */
  doctorCandidatesBefore(
    doctorName: string,
    date: string,
    fields: { doctorField: string; excludedStatuses: string[] },
  ): Promise<DoctorHistoryHit[]>;
  /** Most recent non-excluded invoice to this customer strictly before `date`. */
  lastCustomerInvoiceBefore(customerId: string, date: string, excludedStatuses: string[]): Promise<{ date: string; number: string } | null>;
};

/** An earlier invoice for the doctor; matchedName shows which spelling matched and why. */
export type DoctorHistoryHit = {
  date: string;
  number: string;
  matchedName: string;
  key: string;
  confidence: "exact" | "same" | "possible";
  reason?: string;
};

/** Default reading without admin input: newest exact/same match, else (conservatively) the newest possible one. */
export function pickLastInvoice(hits: DoctorHistoryHit[]): DoctorHistoryHit | null {
  const byDate = [...hits].sort((a, b) => b.date.localeCompare(a.date));
  return byDate.find((h) => h.confidence !== "possible") ?? byDate[0] ?? null;
}

export function toFact(inv: ZohoInvoiceDetail, fields: { doctorField: string; sourceField: string }) {
  const cf = inv.custom_field_hash ?? {};
  return {
    id: inv.invoice_id,
    number: inv.invoice_number,
    date: inv.date,
    status: inv.status,
    customerId: inv.customer_id,
    customerName: inv.customer_name,
    salespersonId: inv.salesperson_id ?? "",
    salespersonName: inv.salesperson_name ?? "",
    doctorName: (cf[fields.doctorField] ?? "").trim(),
    source: (cf[fields.sourceField] ?? "").trim(),
    total: Number(inv.total) || 0,
    lines: (inv.line_items ?? []).map((l) => ({ itemId: l.item_id, name: l.name, amount: Number(l.item_total) || 0 })),
    lastModified: inv.last_modified_time,
  };
}

const zohoSource: InvoiceSource = {
  async resolveItemId(name) {
    const items = await findItemsByName(name);
    return items.find((i) => i.name.trim().toLowerCase() === name.trim().toLowerCase())?.item_id ?? null;
  },
  async listFocusInvoices(itemIds, start, end) {
    const seen = new Map<string, { id: string; lastModified: string; status: string }>();
    for (const itemId of itemIds) {
      const rows = await listInvoices({ item_id: itemId, date_start: start, date_end: end });
      for (const r of rows) seen.set(r.invoice_id, { id: r.invoice_id, lastModified: r.last_modified_time, status: r.status });
    }
    return [...seen.values()];
  },
  async getInvoice(id, fields) {
    return toFact(await getInvoice(id), fields);
  },
  async doctorCandidatesBefore(doctorName, date, fields) {
    const excluded = new Set(fields.excludedStatuses.map((x) => x.toLowerCase()));
    const doctorOf = (r: { custom_field_hash?: Record<string, string> }) => (r.custom_field_hash?.[fields.doctorField] ?? "").trim();
    const valid = (r: { status: string }) => !excluded.has(r.status.toLowerCase());
    const ownKey = doctorNameKey(doctorName);
    const hits = new Map<string, DoctorHistoryHit>(); // newest invoice per spelling key

    const consider = (r: { date: string; invoice_number: string; status: string; custom_field_hash?: Record<string, string> }) => {
      if (!valid(r)) return null;
      const name = doctorOf(r);
      const key = doctorNameKey(name);
      if (!key) return null;
      if (key === ownKey) {
        if (!hits.has(key)) hits.set(key, { date: r.date, number: r.invoice_number, matchedName: name, key, confidence: "exact" });
        return "exact";
      }
      const cmp = compareDoctors(doctorName, name);
      if (!cmp) return null;
      if (!hits.has(key)) hits.set(key, { date: r.date, number: r.invoice_number, matchedName: name, key, confidence: cmp.level, reason: cmp.reason });
      return cmp.level;
    };

    // 1. Exact spelling. `custom_field` matches any custom field, so `consider` re-checks the doctor field.
    await findInvoice({ custom_field: doctorName, date_before: date, sort_column: "date", sort_order: "D" }, (r) => consider(r) === "exact");

    // 2. Spelling variants via the surname (Zoho's contains-search is case-sensitive, so try common casings).
    //    Newest first; stop once a confident match is found, keeping every spelling seen on the way.
    for (const casing of surnameCasings(doctorName)) {
      await findInvoice({ custom_field_contains: casing, date_before: date, sort_column: "date", sort_order: "D" }, (r) => {
        const level = consider(r);
        return level === "same";
      });
    }
    return [...hits.values()];
  },
  async lastCustomerInvoiceBefore(customerId, date, excludedStatuses) {
    const excluded = new Set(excludedStatuses.map((s) => s.toLowerCase()));
    const hit = await findInvoice(
      { customer_id: customerId, date_before: date, sort_column: "date", sort_order: "D" },
      (r) => !excluded.has(r.status.toLowerCase()) && r.customer_id === customerId,
    );
    return hit ? { date: hit.date, number: hit.invoice_number } : null;
  },
};

export function sourceFor(dataSource: "zoho" | "demo"): InvoiceSource {
  return dataSource === "demo" ? demoSource : zohoSource;
}
