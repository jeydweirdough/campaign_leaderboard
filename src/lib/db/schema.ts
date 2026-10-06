import { sql } from "drizzle-orm";
import { boolean, doublePrecision, index, jsonb, pgTable, primaryKey, serial, text } from "drizzle-orm/pg-core";

// Dates are stored as ISO strings (YYYY-MM-DD / full ISO timestamps), matching what Zoho returns
// and what the scoring engine compares, so no conversion is needed anywhere.
const now = sql`to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export const campaigns = pgTable("campaigns", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  tagline: text("tagline").notNull().default(""),
  startDate: text("start_date").notNull(), // YYYY-MM-DD inclusive
  endDate: text("end_date").notNull(), // YYYY-MM-DD inclusive
  /** draft = admin only, live = public, closed = public + frozen sync */
  status: text("status", { enum: ["draft", "live", "closed"] }).notNull().default("draft"),
  ruleset: jsonb("ruleset").notNull(),
  /** zoho = live Zoho Books data, demo = generated sample data */
  dataSource: text("data_source", { enum: ["zoho", "demo"] }).notNull().default("zoho"),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
});

export const teams = pgTable(
  "teams",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    chcName: text("chc_name").notNull().default(""),
    mdName: text("md_name").notNull().default(""),
    region: text("region").notNull().default(""),
    /** Zoho salesperson_ids whose invoices count for this team. */
    salespersonIds: jsonb("salesperson_ids").$type<string[]>().notNull().default([]),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("teams_campaign_idx").on(t.campaignId)],
);

/** Cached Zoho invoices (only those containing at least one focus product). */
export const invoices = pgTable(
  "invoices",
  {
    id: text("id").primaryKey(), // zoho invoice_id
    number: text("number").notNull(),
    date: text("date").notNull(),
    status: text("status").notNull(),
    customerId: text("customer_id").notNull(),
    customerName: text("customer_name").notNull(),
    salespersonId: text("salesperson_id").notNull().default(""),
    salespersonName: text("salesperson_name").notNull().default(""),
    doctorName: text("doctor_name").notNull().default(""),
    source: text("source").notNull().default(""),
    total: doublePrecision("total").notNull(),
    lines: jsonb("lines").$type<{ itemId: string; name: string; amount: number }[]>().notNull(),
    lastModified: text("last_modified").notNull(),
    fetchedAt: text("fetched_at").notNull().default(now),
  },
  (t) => [index("invoices_date_idx").on(t.date)],
);

/** Most recent Zoho invoice for a doctor before a given date (for New / Reactivation). */
export const doctorHistory = pgTable(
  "doctor_history",
  {
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    doctorKey: text("doctor_key").notNull(),
    doctorName: text("doctor_name").notNull(),
    checkedBefore: text("checked_before").notNull(),
    lastInvoiceDate: text("last_invoice_date"),
    lastInvoiceNumber: text("last_invoice_number"),
    /** The doctor-field spelling on that invoice, and how it was matched (exact / same / possible). */
    matchedName: text("matched_name"),
    matchConfidence: text("match_confidence"),
    /** Every earlier-invoice match found (exact + spelling variants), so admin decisions can re-pick. */
    candidates: jsonb("candidates").$type<DoctorCandidate[]>().notNull().default([]),
    checkedAt: text("checked_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.doctorKey] })],
);

export type DoctorCandidate = {
  name: string;
  key: string;
  date: string;
  number: string;
  confidence: "exact" | "same" | "possible";
  reason?: string;
};

/**
 * Two doctor-name spellings that may be the same person, plus the admin's verdict.
 * Global (not per campaign): "Audie Cuntapay" = "Dr. Audie V. Cuntapay" is true everywhere.
 */
export const doctorMatches = pgTable(
  "doctor_matches",
  {
    keyA: text("key_a").notNull(), // keyA < keyB
    keyB: text("key_b").notNull(),
    nameA: text("name_a").notNull(),
    nameB: text("name_b").notNull(),
    /** What the matcher thinks: same = applied automatically, possible = held for review. */
    level: text("level", { enum: ["same", "possible"] }).notNull(),
    reason: text("reason").notNull().default(""),
    decision: text("decision", { enum: ["pending", "same", "different"] }).notNull().default("pending"),
    /** Example invoices for each spelling, to help the reviewer. */
    evidence: jsonb("evidence").$type<{ a?: { number: string; date: string }; b?: { number: string; date: string } }>().notNull().default({}),
    campaignId: text("campaign_id"),
    createdAt: text("created_at").notNull().default(now),
    decidedAt: text("decided_at"),
  },
  (t) => [primaryKey({ columns: [t.keyA, t.keyB] })],
);

/** Most recent Zoho invoice to a customer (hospital) before its first qualifying order. */
export const customerHistory = pgTable(
  "customer_history",
  {
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    customerId: text("customer_id").notNull(),
    customerName: text("customer_name").notNull(),
    checkedBefore: text("checked_before").notNull(),
    lastInvoiceDate: text("last_invoice_date"),
    lastInvoiceNumber: text("last_invoice_number"),
    checkedAt: text("checked_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.customerId] })],
);

export const claims = pgTable("claims", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  ruleId: text("rule_id").notNull(),
  date: text("date").notNull(),
  entityName: text("entity_name").notNull(),
  groupId: text("group_id").notNull(),
  evidence: text("evidence").notNull().default(""),
  status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
  reviewNote: text("review_note").notNull().default(""),
  createdAt: text("created_at").notNull().default(now),
});

export const adjustments = pgTable("adjustments", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  missionId: text("mission_id"),
  points: doublePrecision("points").notNull(),
  reason: text("reason").notNull(),
  createdAt: text("created_at").notNull().default(now),
});

/** Invoices management has ruled out (cancelled, split, duplicate…). */
export const exclusions = pgTable(
  "exclusions",
  {
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    invoiceId: text("invoice_id").notNull(),
    reason: text("reason").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.invoiceId] })],
);

export const syncLogs = pgTable("sync_logs", {
  id: serial("id").primaryKey(),
  campaignId: text("campaign_id").notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  ok: boolean("ok").notNull().default(false),
  summary: text("summary").notNull().default(""),
});
