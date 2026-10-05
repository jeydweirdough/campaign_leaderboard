import { sql } from "drizzle-orm";
import { integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

export const campaigns = sqliteTable("campaigns", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  tagline: text("tagline").notNull().default(""),
  startDate: text("start_date").notNull(), // YYYY-MM-DD inclusive
  endDate: text("end_date").notNull(), // YYYY-MM-DD inclusive
  /** draft = admin only, live = public, closed = public + frozen sync */
  status: text("status", { enum: ["draft", "live", "closed"] }).notNull().default("draft"),
  ruleset: text("ruleset", { mode: "json" }).notNull(),
  /** zoho = live Zoho Books data, demo = generated sample data */
  dataSource: text("data_source", { enum: ["zoho", "demo"] }).notNull().default("zoho"),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
});

export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  chcName: text("chc_name").notNull().default(""),
  mdName: text("md_name").notNull().default(""),
  region: text("region").notNull().default(""),
  /** Zoho salesperson_ids whose invoices count for this team. */
  salespersonIds: text("salesperson_ids", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  createdAt: text("created_at").notNull().default(now),
});

/** Cached Zoho invoices (only those containing at least one focus product). */
export const invoices = sqliteTable("invoices", {
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
  total: real("total").notNull(),
  lines: text("lines", { mode: "json" }).$type<{ itemId: string; name: string; amount: number }[]>().notNull(),
  lastModified: text("last_modified").notNull(),
  fetchedAt: text("fetched_at").notNull().default(now),
});

/** Most recent Zoho invoice for a doctor before a given date (for New / Reactivation). */
export const doctorHistory = sqliteTable(
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
    checkedAt: text("checked_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.doctorKey] })],
);

/** Most recent Zoho invoice to a customer (hospital) before its first qualifying order. */
export const customerHistory = sqliteTable(
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

export const claims = sqliteTable("claims", {
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

export const adjustments = sqliteTable("adjustments", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  missionId: text("mission_id"),
  points: integer("points").notNull(),
  reason: text("reason").notNull(),
  createdAt: text("created_at").notNull().default(now),
});

/** Invoices management has ruled out (cancelled, split, duplicate…). */
export const exclusions = sqliteTable(
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

export const syncLogs = sqliteTable("sync_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  campaignId: text("campaign_id").notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  ok: integer("ok", { mode: "boolean" }).notNull().default(false),
  summary: text("summary").notNull().default(""),
});
