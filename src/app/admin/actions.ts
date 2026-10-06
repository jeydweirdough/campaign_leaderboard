"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { rulesetSchema } from "@/lib/rules/schema";
import { RISE_3_RULESET } from "@/lib/rules/presets";
import { syncCampaign, type SyncSummary } from "@/lib/sync";
import { searchItems } from "@/lib/zoho/client";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const done = (campaignId: string) => revalidatePath(`/admin/c/${campaignId}`, "layout");

const BLANK_RULESET = {
  productGroups: [{ id: "focus", name: "Focus products", rank: 1, products: [] }],
  missions: [{ id: "sales", name: "Sales", subtitle: "Product sales", color: "#f97316" }],
  rules: [],
  awards: [],
};

// ---- Campaigns ------------------------------------------------------------

export async function createCampaign(fd: FormData) {
  await requireAdmin();
  const template = str(fd, "template");
  let ruleset: unknown = template === "rise3" ? RISE_3_RULESET : BLANK_RULESET;
  if (template.startsWith("copy:")) {
    const src = await db.query.campaigns.findFirst({ where: eq(schema.campaigns.id, template.slice(5)) });
    if (src) ruleset = src.ruleset;
  }
  const id = crypto.randomUUID();
  const slug = str(fd, "slug").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
  await db.insert(schema.campaigns).values({
    id,
    slug: slug || id.slice(0, 8),
    name: str(fd, "name"),
    tagline: str(fd, "tagline"),
    startDate: str(fd, "startDate"),
    endDate: str(fd, "endDate"),
    dataSource: str(fd, "dataSource") === "demo" ? "demo" : "zoho",
    status: "draft",
    ruleset: rulesetSchema.parse(ruleset),
  });
  redirect(`/admin/c/${id}`);
}

export async function updateCampaign(id: string, fd: FormData) {
  await requireAdmin();
  const status = str(fd, "status");
  await db
    .update(schema.campaigns)
    .set({
      name: str(fd, "name"),
      slug: str(fd, "slug").toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
      tagline: str(fd, "tagline"),
      startDate: str(fd, "startDate"),
      endDate: str(fd, "endDate"),
      status: status === "live" || status === "closed" ? status : "draft",
      dataSource: str(fd, "dataSource") === "demo" ? "demo" : "zoho",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.campaigns.id, id));
  done(id);
}

export async function deleteCampaign(id: string) {
  await requireAdmin();
  await db.delete(schema.campaigns).where(eq(schema.campaigns.id, id));
  redirect("/admin");
}

export async function saveRuleset(id: string, json: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  let parsed;
  try {
    parsed = rulesetSchema.safeParse(JSON.parse(json));
  } catch {
    return { ok: false, error: "Invalid JSON" };
  }
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n") };
  }
  const r = parsed.data;
  const missionIds = new Set(r.missions.map((m) => m.id));
  const groupIds = new Set(r.productGroups.map((g) => g.id));
  const problems: string[] = [];
  const dup = (arr: string[]) => arr.filter((x, i) => arr.indexOf(x) !== i);
  for (const d of dup(r.rules.map((x) => x.id))) problems.push(`Duplicate rule id "${d}"`);
  for (const d of dup(r.productGroups.map((x) => x.id))) problems.push(`Duplicate group id "${d}"`);
  for (const rule of r.rules) {
    if (!missionIds.has(rule.missionId)) problems.push(`Rule "${rule.label}" uses unknown mission "${rule.missionId}"`);
    const keys = rule.type === "sales_rate" ? Object.keys(rule.rates) : "points" in rule && typeof rule.points === "object" ? Object.keys(rule.points) : [];
    for (const k of keys) if (!groupIds.has(k)) problems.push(`Rule "${rule.label}" references unknown group "${k}"`);
  }
  if (problems.length) return { ok: false, error: problems.join("\n") };

  await db.update(schema.campaigns).set({ ruleset: r, updatedAt: new Date().toISOString() }).where(eq(schema.campaigns.id, id));
  done(id);
  return { ok: true };
}

export async function runSync(id: string): Promise<{ ok: true; summary: SyncSummary } | { ok: false; error: string }> {
  await requireAdmin();
  try {
    const summary = await syncCampaign(id);
    done(id);
    return { ok: true, summary };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function searchZohoItems(q: string) {
  await requireAdmin();
  try {
    return { ok: true as const, items: await searchItems(q) };
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }
}

// ---- Teams ----------------------------------------------------------------

export async function saveTeam(campaignId: string, fd: FormData) {
  await requireAdmin();
  const id = str(fd, "id");
  const values = {
    name: str(fd, "name"),
    chcName: str(fd, "chcName"),
    mdName: str(fd, "mdName"),
    region: str(fd, "region"),
    salespersonIds: fd.getAll("salespersonIds").map(String).filter(Boolean),
  };
  if (id) await db.update(schema.teams).set(values).where(and(eq(schema.teams.id, id), eq(schema.teams.campaignId, campaignId)));
  else await db.insert(schema.teams).values({ id: crypto.randomUUID(), campaignId, ...values });
  done(campaignId);
}

export async function deleteTeam(campaignId: string, teamId: string) {
  await requireAdmin();
  await db.delete(schema.teams).where(and(eq(schema.teams.id, teamId), eq(schema.teams.campaignId, campaignId)));
  done(campaignId);
}

export async function createTeamFromSalesperson(campaignId: string, salespersonId: string, salespersonName: string) {
  await requireAdmin();
  await db.insert(schema.teams).values({
    id: crypto.randomUUID(),
    campaignId,
    name: salespersonName,
    region: salespersonName.split("|")[1]?.trim() ?? "",
    salespersonIds: [salespersonId],
  });
  done(campaignId);
}

// ---- Claims ---------------------------------------------------------------

export async function addClaim(campaignId: string, fd: FormData) {
  await requireAdmin();
  await db.insert(schema.claims).values({
    id: crypto.randomUUID(),
    campaignId,
    teamId: str(fd, "teamId"),
    ruleId: str(fd, "ruleId"),
    date: str(fd, "date"),
    entityName: str(fd, "entityName"),
    groupId: str(fd, "groupId"),
    evidence: str(fd, "evidence"),
    status: str(fd, "status") === "approved" ? "approved" : "pending",
  });
  done(campaignId);
}

export async function reviewClaim(campaignId: string, claimId: string, status: "approved" | "rejected" | "pending", fd?: FormData) {
  await requireAdmin();
  await db
    .update(schema.claims)
    .set({ status, reviewNote: fd ? str(fd, "reviewNote") : "" })
    .where(and(eq(schema.claims.id, claimId), eq(schema.claims.campaignId, campaignId)));
  done(campaignId);
}

export async function deleteClaim(campaignId: string, claimId: string) {
  await requireAdmin();
  await db.delete(schema.claims).where(and(eq(schema.claims.id, claimId), eq(schema.claims.campaignId, campaignId)));
  done(campaignId);
}

// ---- Adjustments & exclusions ---------------------------------------------

export async function addAdjustment(campaignId: string, fd: FormData) {
  await requireAdmin();
  const points = Number(str(fd, "points"));
  if (!Number.isFinite(points) || points === 0) return;
  await db.insert(schema.adjustments).values({
    id: crypto.randomUUID(),
    campaignId,
    teamId: str(fd, "teamId"),
    missionId: str(fd, "missionId") || null,
    points,
    reason: str(fd, "reason"),
  });
  done(campaignId);
}

export async function deleteAdjustment(campaignId: string, id: string) {
  await requireAdmin();
  await db.delete(schema.adjustments).where(and(eq(schema.adjustments.id, id), eq(schema.adjustments.campaignId, campaignId)));
  done(campaignId);
}

export async function excludeInvoice(campaignId: string, fd: FormData) {
  await requireAdmin();
  const invoiceId = str(fd, "invoiceId");
  const reason = str(fd, "reason") || "Excluded by management";
  await db
    .insert(schema.exclusions)
    .values({ campaignId, invoiceId, reason })
    .onConflictDoUpdate({ target: [schema.exclusions.campaignId, schema.exclusions.invoiceId], set: { reason } });
  done(campaignId);
}

export async function includeInvoice(campaignId: string, invoiceId: string) {
  await requireAdmin();
  await db.delete(schema.exclusions).where(and(eq(schema.exclusions.campaignId, campaignId), eq(schema.exclusions.invoiceId, invoiceId)));
  done(campaignId);
}

// ---- Doctor name matches -----------------------------------------------------

export async function decideDoctorMatch(campaignId: string, keyA: string, keyB: string, decision: "same" | "different" | "pending") {
  await requireAdmin();
  await db
    .update(schema.doctorMatches)
    .set({ decision, decidedAt: decision === "pending" ? null : new Date().toISOString() })
    .where(and(eq(schema.doctorMatches.keyA, keyA), eq(schema.doctorMatches.keyB, keyB)));
  done(campaignId);
  revalidatePath("/c", "layout"); // public scores change with the verdict
}
