import "server-only";

/**
 * Minimal read-only Zoho Books client (OAuth refresh-token flow).
 * Honors ZOHO_ORG_ID / ZOHO_ALLOWED_ORG_IDS so the app can never read from an
 * org that isn't explicitly allow-listed.
 */

export type ZohoConfig = {
  mode: "live" | "mock";
  orgId: string;
  dryRun: boolean;
};

export function zohoConfig(): ZohoConfig {
  const mode = (process.env.ZOHO_MODE ?? "mock").toLowerCase() === "live" ? "live" : "mock";
  const orgId = process.env.ZOHO_ORG_ID ?? "";
  const allowed = (process.env.ZOHO_ALLOWED_ORG_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (mode === "live") {
    if (!orgId) throw new Error("ZOHO_ORG_ID is not set.");
    if (!allowed.includes(orgId)) throw new Error(`Zoho org ${orgId} is not in ZOHO_ALLOWED_ORG_IDS.`);
  }
  return { mode, orgId, dryRun: (process.env.ZOHO_DRY_RUN ?? "false").toLowerCase() === "true" };
}

const ACCOUNTS_URL = process.env.ZOHO_ACCOUNTS_URL ?? "https://accounts.zoho.com";
const API_BASE = process.env.ZOHO_API_BASE ?? "https://www.zohoapis.com/books/v3";
const MIN_INTERVAL_MS = 700; // Zoho Books allows ~100 req/min per org

let token: { value: string; expiresAt: number } | null = null;
let lastCall = 0;

async function accessToken(): Promise<string> {
  if (token && Date.now() < token.expiresAt - 60_000) return token.value;
  const { ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN } = process.env;
  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN) {
    throw new Error("Zoho OAuth is not configured: set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET and ZOHO_REFRESH_TOKEN.");
  }
  const params = new URLSearchParams({
    refresh_token: ZOHO_REFRESH_TOKEN,
    client_id: ZOHO_CLIENT_ID,
    client_secret: ZOHO_CLIENT_SECRET,
    grant_type: "refresh_token",
  });
  const res = await fetch(`${ACCOUNTS_URL}/oauth/v2/token?${params}`, { method: "POST" });
  const body = await res.json();
  if (!res.ok || !body.access_token) throw new Error(`Zoho token refresh failed: ${JSON.stringify(body)}`);
  token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return token.value;
}

async function zohoGet<T>(path: string, query: Record<string, string | number | undefined>, attempt = 0): Promise<T> {
  const { orgId } = zohoConfig();
  const wait = lastCall + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();

  const qs = new URLSearchParams({ organization_id: orgId });
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") qs.set(k, String(v));
  const res = await fetch(`${API_BASE}${path}?${qs}`, {
    headers: { Authorization: `Zoho-oauthtoken ${await accessToken()}` },
    cache: "no-store",
  });
  if (res.status === 429 && attempt < 4) {
    await new Promise((r) => setTimeout(r, 5_000 * (attempt + 1)));
    return zohoGet(path, query, attempt + 1);
  }
  if (res.status === 401 && attempt === 0) {
    token = null;
    return zohoGet(path, query, 1);
  }
  const body = await res.json();
  if (!res.ok || body.code !== 0) throw new Error(`Zoho ${path} failed (${res.status}): ${body.message ?? JSON.stringify(body)}`);
  return body as T;
}

export type ZohoInvoiceSummary = {
  invoice_id: string;
  invoice_number: string;
  date: string;
  status: string;
  last_modified_time: string;
  customer_id: string;
  customer_name: string;
  salesperson_id?: string;
  salesperson_name?: string;
  total: number;
  custom_field_hash?: Record<string, string>;
};

export type ZohoInvoiceDetail = ZohoInvoiceSummary & {
  line_items: { item_id: string; name: string; item_total: number; quantity: number }[];
};

type Paged<K extends string, T> = { [key in K]: T[] } & { page_context?: { has_more_page?: boolean } };

export async function listInvoices(query: Record<string, string | number | undefined>): Promise<ZohoInvoiceSummary[]> {
  const out: ZohoInvoiceSummary[] = [];
  for (let page = 1; page < 200; page++) {
    const body = await zohoGet<Paged<"invoices", ZohoInvoiceSummary>>("/invoices", { ...query, page, per_page: 200 });
    out.push(...body.invoices);
    if (!body.page_context?.has_more_page) break;
  }
  return out;
}

/** Pages through results (newest first if sorted) and stops at the first row `match` accepts. */
export async function findInvoice(
  query: Record<string, string | number | undefined>,
  match: (r: ZohoInvoiceSummary) => boolean,
  maxPages = 10,
): Promise<ZohoInvoiceSummary | null> {
  for (let page = 1; page <= maxPages; page++) {
    const body = await zohoGet<Paged<"invoices", ZohoInvoiceSummary>>("/invoices", { ...query, page, per_page: 200 });
    const hit = body.invoices.find(match);
    if (hit) return hit;
    if (!body.page_context?.has_more_page) break;
  }
  return null;
}

export async function getInvoice(id: string): Promise<ZohoInvoiceDetail> {
  const body = await zohoGet<{ invoice: ZohoInvoiceDetail }>(`/invoices/${id}`, {});
  return body.invoice;
}

export async function findItemsByName(name: string): Promise<{ item_id: string; name: string }[]> {
  const body = await zohoGet<Paged<"items", { item_id: string; name: string }>>("/items", { name_contains: name, per_page: 50 });
  return body.items;
}

export async function searchItems(text: string): Promise<{ item_id: string; name: string; sku: string }[]> {
  const body = await zohoGet<Paged<"items", { item_id: string; name: string; sku: string }>>("/items", {
    search_text: text,
    per_page: 25,
  });
  return body.items;
}
