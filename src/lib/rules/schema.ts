import { z } from "zod";

/**
 * A campaign ruleset is plain JSON stored on the campaign row. Admins edit it
 * from the UI; the engine (engine.ts) turns invoices + claims into points.
 *
 * Every rule that awards "per group" points uses the order's *group*: the
 * highest-ranked product group present among the order's focus line items
 * (rank 1 = highest). Orders with no focus product never score.
 */

export const productSchema = z.object({
  /** Zoho item name, matched case-insensitively and exactly (e.g. "PazoGet 400mg"). */
  name: z.string().min(1),
  /** Zoho item_id; resolved automatically on sync when missing. */
  itemId: z.string().optional(),
});

export const productGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  rank: z.number().int().min(1),
  products: z.array(productSchema),
});

export const missionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  subtitle: z.string().default(""),
  color: z.string().default("#f97316"),
});

/** groupId -> points */
const groupPoints = z.record(z.string(), z.number());

const ruleBase = {
  id: z.string().min(1),
  missionId: z.string().min(1),
  label: z.string().min(1),
  description: z.string().default(""),
  enabled: z.boolean().default(true),
  /** Only invoices whose `cf_source` is in this list count. Empty = any source. */
  sourceFilter: z.array(z.string()).default([]),
};

export const ruleSchema = z.discriminatedUnion("type", [
  /** X points per Y currency of focus-product sales, per group. */
  z.object({
    ...ruleBase,
    type: z.literal("sales_rate"),
    rates: z.record(z.string(), z.object({ per: z.number().positive(), points: z.number() })),
    /** "team_total": floor(total group sales / per) per team. "per_invoice": floor per invoice line group. */
    aggregation: z.enum(["team_total", "per_invoice"]).default("team_total"),
  }),
  /** First-ever order for a doctor (no invoice in Zoho before the campaign). */
  z.object({
    ...ruleBase,
    type: z.literal("doctor_new"),
    points: groupPoints,
  }),
  /** Doctor's last invoice before the campaign is >= N months before this order. */
  z.object({
    ...ruleBase,
    type: z.literal("doctor_reactivation"),
    minMonthsGap: z.number().int().positive(),
    points: groupPoints,
  }),
  /** Nth order from the same doctor / hospital in the same calendar month. */
  z.object({
    ...ruleBase,
    type: z.literal("repeat_order"),
    entity: z.enum(["doctor", "customer"]),
    nth: z.number().int().min(2).default(2),
    /** If true, every order from the Nth onward scores; otherwise only the Nth. */
    includeAfterNth: z.boolean().default(false),
    points: groupPoints,
  }),
  /** Flat points per qualifying invoice (use sourceFilter, e.g. "Hospital PO"). */
  z.object({
    ...ruleBase,
    type: z.literal("per_order"),
    /** Only score if the customer (e.g. hospital) had no Zoho invoice in the N months before this order. */
    newCustomerMonths: z.number().int().positive().optional(),
    points: groupPoints,
  }),
  /** Single order at or above a value threshold earns a bonus. */
  z.object({
    ...ruleBase,
    type: z.literal("order_threshold"),
    minAmount: z.number().positive(),
    /** focus_products: only focus line items count toward the threshold. */
    basis: z.enum(["focus_products", "invoice_total"]).default("focus_products"),
    requireDoctor: z.boolean().default(true),
    points: z.number(),
  }),
  /** Manually submitted + approved achievements (e.g. Hospital Inclusion letters). */
  z.object({
    ...ruleBase,
    type: z.literal("manual_claim"),
    points: groupPoints,
  }),
]);

export const awardSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  subtitle: z.string().default(""),
  prize: z.string().default(""),
  basis: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("overall_rank"), place: z.number().int().min(1) }),
    z.object({ kind: z.literal("mission_points"), missionId: z.string() }),
    z.object({ kind: z.literal("rule_points"), ruleId: z.string() }),
    z.object({ kind: z.literal("max_single_order") }),
  ]),
  /** Overall top-N winners can't also take this special award. */
  excludeOverallWinners: z.boolean().default(false),
});

export const rulesetSchema = z.object({
  productGroups: z.array(productGroupSchema).min(1),
  missions: z.array(missionSchema).min(1),
  rules: z.array(ruleSchema),
  awards: z.array(awardSchema).default([]),
  zoho: z
    .object({
      doctorField: z.string().default("cf_doctor_name"),
      sourceField: z.string().default("cf_source"),
      /** Doctor field values that mean "no doctor". */
      blankDoctorValues: z.array(z.string()).default(["", "na", "n/a", "none", "-"]),
      excludedStatuses: z.array(z.string()).default(["draft", "void"]),
    })
    .default({
      doctorField: "cf_doctor_name",
      sourceField: "cf_source",
      blankDoctorValues: ["", "na", "n/a", "none", "-"],
      excludedStatuses: ["draft", "void"],
    }),
});

export type Product = z.infer<typeof productSchema>;
export type ProductGroup = z.infer<typeof productGroupSchema>;
export type Mission = z.infer<typeof missionSchema>;
export type Rule = z.infer<typeof ruleSchema>;
export type RuleType = Rule["type"];
export type Award = z.infer<typeof awardSchema>;
export type Ruleset = z.infer<typeof rulesetSchema>;

export const RULE_TYPE_LABELS: Record<RuleType, string> = {
  sales_rate: "Sales rate (points per amount)",
  doctor_new: "New doctor (no prior invoice)",
  doctor_reactivation: "Doctor reactivation (inactive N months)",
  repeat_order: "Repeat order in same month",
  per_order: "Flat points per order",
  order_threshold: "High-value order bonus",
  manual_claim: "Manual claim (needs approval)",
};

export function parseRuleset(raw: unknown): Ruleset {
  return rulesetSchema.parse(typeof raw === "string" ? JSON.parse(raw) : raw);
}
