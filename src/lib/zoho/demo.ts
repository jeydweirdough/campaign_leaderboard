import type { InvoiceFact } from "@/lib/rules/engine";
import type { InvoiceSource } from "./source";
import { addMonths } from "@/lib/rules/engine";
import { doctorNameKey } from "@/lib/rules/doctor-match";

/**
 * Deterministic fake Zoho data so the leaderboard can be explored without
 * credentials. Same inputs always produce the same invoices.
 */

export const DEMO_SALESPERSONS = [
  { id: "demo-sp-1", name: "HOS | DEMO NORTH" },
  { id: "demo-sp-2", name: "HOS | DEMO SOUTH" },
  { id: "demo-sp-3", name: "B&B | DEMO EAST" },
  { id: "demo-sp-4", name: "B&B | DEMO WEST" },
  { id: "demo-sp-5", name: "HOS | DEMO CENTRAL" },
  { id: "demo-sp-6", name: "B2B | DEMO METRO" },
];

const PRODUCTS = [
  { id: "2254168001994779289", name: "PazoGet 400mg", price: 1113 },
  { id: "2254168001994823001", name: "Beltro 25mg", price: 455 },
  { id: "2254168001998793001", name: "DoxGet-50", price: 2400 },
  { id: "2254168001951492459", name: "PaloGet", price: 1800 },
  { id: "2254168001990103023", name: "ErpoGet", price: 950 },
  { id: "2254168001985754025", name: "SoraGet 200mg", price: 600 },
  { id: "2254168001978669628", name: "DanaGet 200MG", price: 320 },
  { id: "2254168001993053108", name: "SevelaMed", price: 25 },
  { id: "2254168001909515007", name: "Getfil 300", price: 40 },
  { id: "2254168001980167261", name: "BleoGet", price: 1500 },
  { id: "demo-other", name: "Paracetamol 500mg", price: 3 },
];

const DOCTORS = [
  "Maria Santos", "Jose Reyes", "Ana Cruz", "Paolo Garcia", "Liza Mendoza", "Carlo Bautista",
  "Grace Villanueva", "Mark Ramos", "Joy Aquino", "Rafael Torres", "Nina Castillo", "Ben Navarro",
  "Kristine Flores", "Miguel Dizon", "Sofia Lim", "Andres Tan",
];
const HOSPITALS = ["St. Demo Medical Center", "Demo General Hospital", "Sample Doctors Hospital", "Mock Cancer Institute"];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

function generate(start: string, end: string): (InvoiceFact & { lastModified: string })[] {
  const rand = rng(hash(start + end));
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const out: (InvoiceFact & { lastModified: string })[] = [];
  const today = new Date().toISOString().slice(0, 10);
  let n = 1;
  for (let d = start; d <= end && d <= today; d = new Date(Date.parse(d) + 86_400_000).toISOString().slice(0, 10)) {
    const perDay = 2 + Math.floor(rand() * 5);
    for (let i = 0; i < perDay; i++) {
      const sp = pick(DEMO_SALESPERSONS);
      const isHospital = rand() < 0.15;
      const nLines = 1 + Math.floor(rand() * 2);
      const lines = Array.from({ length: nLines }, () => {
        const p = pick(PRODUCTS);
        const big = rand() < 0.06;
        const qty = big ? Math.ceil(110_000 / p.price) : 5 + Math.floor(rand() * 40);
        return { itemId: p.id, name: p.name, amount: Math.round(qty * p.price * 100) / 100 };
      });
      const total = lines.reduce((a, l) => a + l.amount, 0);
      const hospital = pick(HOSPITALS);
      out.push({
        id: `demo-${d}-${i}`,
        number: `DEMO-${String(n++).padStart(5, "0")}`,
        date: d,
        status: rand() < 0.04 ? "void" : "paid",
        customerId: isHospital ? `demo-h-${hash(hospital)}` : `demo-c-${Math.floor(rand() * 500)}`,
        customerName: isHospital ? hospital : `Patient ${Math.floor(rand() * 500)}`,
        salespersonId: sp.id,
        salespersonName: sp.name,
        doctorName: isHospital ? "NA" : rand() < 0.15 ? "NA" : pick(DOCTORS),
        source: isHospital ? (rand() < 0.3 ? "Emergency purchase" : "Hospital PO") : pick(["Doctor order", "Patient order referred by doctor"]),
        total: Math.round(total * 100) / 100,
        lines,
        lastModified: `${d}T12:00:00+0800`,
      });
    }
  }
  return out;
}

const cache = new Map<string, ReturnType<typeof generate>>();
let lastRange = { start: "", end: "" };
function all(start: string, end: string) {
  const key = `${start}|${end}`;
  if (!cache.has(key)) cache.set(key, generate(start, end));
  lastRange = { start, end };
  return cache.get(key)!;
}

export const demoSource: InvoiceSource = {
  async resolveItemId(name) {
    return PRODUCTS.find((p) => p.name.toLowerCase() === name.trim().toLowerCase())?.id ?? null;
  },
  async listFocusInvoices(itemIds, start, end) {
    const ids = new Set(itemIds);
    return all(start, end)
      .filter((inv) => inv.lines.some((l) => ids.has(l.itemId)))
      .map((inv) => ({ id: inv.id, lastModified: inv.lastModified, status: inv.status }));
  },
  async getInvoice(id) {
    const inv = all(lastRange.start, lastRange.end).find((i) => i.id === id);
    if (!inv) throw new Error(`Demo invoice ${id} not found`);
    return inv;
  },
  async lastCustomerInvoiceBefore(customerId, date) {
    // Half the demo hospitals are "new" (nothing in the last 6 months).
    return hash(customerId) % 2 ? null : { date: addMonths(date, -2), number: "DEMO-HIST" };
  },
  async doctorCandidatesBefore(doctorName, date) {
    const h = hash(doctorName) % 10;
    const key = doctorNameKey(doctorName);
    if (h < 3) return []; // brand-new doctor
    const months = h < 5 ? -(7 + (h % 4)) : -1; // dormant 7+ months, or recent
    return [{ date: addMonths(date, months), number: "DEMO-HIST", matchedName: doctorName, key, confidence: "exact" as const }];
  },
};
