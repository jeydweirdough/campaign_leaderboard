import "server-only";
import type { InvoiceFact } from "@/lib/rules/engine";
import { getInvoice, listInvoices, findInvoice, findItemsByName, type ZohoInvoiceDetail } from "./client";
import { compareDoctors, surnameCasings } from "@/lib/rules/doctor-match";
import { demoSource } from "./demo";

/** Where invoice facts come from. Live Zoho Books, or generated demo data. */
export type InvoiceSource = {
  /** item name -> item_id (exact, case-insensitive match) */
  resolveItemId(name: string): Promise<string | null>;
  /** Invoice ids + last-modified stamps containing any of these items in the date range. */
  listFocusInvoices(itemIds: string[], start: string, end: string): Promise<{ id: string; lastModified: string; status: string }[]>;
  getInvoice(id: string, fields: { doctorField: string; sourceField: string }): Promise<InvoiceFact & { lastModified: string }>;
  /** Most recent non-void invoice for this doctor strictly before `date`. */
  lastDoctorInvoiceBefore(
    doctorName: string,
    date: string,
    fields: { doctorField: string; excludedStatuses: string[] },
  ): Promise<DoctorHistoryHit | null>;
  /** Most recent non-excluded invoice to this customer strictly before `date`. */
  lastCustomerInvoiceBefore(customerId: string, date: string, excludedStatuses: string[]): Promise<{ date: string; number: string } | null>;
};

/** An earlier invoice for the doctor; matchedName shows which spelling matched. */
export type DoctorHistoryHit = { date: string; number: string; matchedName: string; confidence: "exact" | "same" | "possible" };

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
  async lastDoctorInvoiceBefore(doctorName, date, fields) {
    const excluded = new Set(fields.excludedStatuses.map((s) => s.toLowerCase()));
    const doctorOf = (r: { custom_field_hash?: Record<string, string> }) => (r.custom_field_hash?.[fields.doctorField] ?? "").trim();
    const valid = (r: { status: string }) => !excluded.has(r.status.toLowerCase());
    const candidates: DoctorHistoryHit[] = [];

    // 1. Exact spelling (`custom_field` matches any custom field, so re-check the doctor field).
    const want = doctorName.trim().toLowerCase();
    const exact = await findInvoice(
      { custom_field: doctorName, date_before: date, sort_column: "date", sort_order: "D" },
      (r) => valid(r) && doctorOf(r).toLowerCase() === want,
    );
    if (exact) candidates.push({ date: exact.date, number: exact.invoice_number, matchedName: doctorOf(exact), confidence: "exact" });

    // 2. Spelling variants: same surname, compatible first name ("Dr. Audie V. Cuntapay" = "Audie Cuntapay").
    //    One pass per casing: stop at the newest confirmed match, remembering the newest surname-only one on the way.
    for (const casing of surnameCasings(doctorName)) {
      let possible: (typeof candidates)[number] | null = null;
      const same = await findInvoice({ custom_field_contains: casing, date_before: date, sort_column: "date", sort_order: "D" }, (r) => {
        if (!valid(r)) return false;
        const level = compareDoctors(doctorName, doctorOf(r));
        if (level === "possible" && !possible) possible = { date: r.date, number: r.invoice_number, matchedName: doctorOf(r), confidence: "possible" };
        return level === "same";
      });
      if (same) candidates.push({ date: same.date, number: same.invoice_number, matchedName: doctorOf(same), confidence: "same" });
      if (possible) candidates.push(possible);
    }

    // Most recent confirmed match wins; a surname-only match counts (conservatively) only if nothing else exists.
    const confirmed = candidates.filter((c) => c.confidence !== "possible").sort((a, b) => b.date.localeCompare(a.date));
    if (confirmed.length) return confirmed[0];
    return candidates.sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
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
