import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/lib/db";
import { getCampaign } from "@/lib/score";
import { parseRuleset } from "@/lib/rules/schema";
import { fmtDate } from "@/lib/format";
import { addClaim, deleteClaim, reviewClaim } from "../../../actions";

export const dynamic = "force-dynamic";

const STATUS = { pending: "text-accent", approved: "text-good", rejected: "text-bad" };

export default async function ClaimsPage({ params }: PageProps<"/admin/c/[id]/claims">) {
  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) notFound();
  const ruleset = parseRuleset(campaign.ruleset);
  const claimRules = ruleset.rules.filter((r) => r.type === "manual_claim");
  const [teams, claims] = await Promise.all([
    db.query.teams.findMany({ where: eq(schema.teams.campaignId, id), orderBy: schema.teams.name }),
    db.query.claims.findMany({ where: eq(schema.claims.campaignId, id), orderBy: desc(schema.claims.createdAt) }),
  ]);
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const ruleLabel = new Map(ruleset.rules.map((r) => [r.id, r.label]));
  const groupName = new Map(ruleset.productGroups.map((g) => [g.id, g.name]));

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <section>
        <p className="mb-3 text-sm text-muted">
          Achievements that can&apos;t be read from Zoho invoices (e.g. official hospital inclusion letters). Only approved claims score.
        </p>
        <div className="card divide-y divide-line">
          {claims.map((c) => (
            <div key={c.id} className="flex flex-wrap items-start gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-semibold">{c.entityName}</span>
                  <span className={`text-xs font-bold uppercase ${STATUS[c.status]}`}>{c.status}</span>
                </div>
                <div className="text-xs text-muted">
                  {teamName.get(c.teamId)} · {ruleLabel.get(c.ruleId) ?? c.ruleId} · {groupName.get(c.groupId) ?? c.groupId} · {fmtDate(c.date)}
                </div>
                {c.evidence && <div className="mt-1 text-sm">{/^https?:\/\//.test(c.evidence) ? <a href={c.evidence} target="_blank" rel="noreferrer" className="text-accent underline">Evidence ↗</a> : c.evidence}</div>}
                {c.reviewNote && <div className="mt-1 text-xs italic text-muted">Review: {c.reviewNote}</div>}
              </div>
              <form className="flex flex-wrap items-center gap-2">
                <input name="reviewNote" className="input w-40" placeholder="Review note" defaultValue={c.reviewNote} />
                {c.status !== "approved" && <button formAction={reviewClaim.bind(null, id, c.id, "approved")} className="btn btn-sm text-good">Approve</button>}
                {c.status !== "rejected" && <button formAction={reviewClaim.bind(null, id, c.id, "rejected")} className="btn btn-sm text-bad">Reject</button>}
                <button formAction={deleteClaim.bind(null, id, c.id)} className="btn btn-sm">Delete</button>
              </form>
            </div>
          ))}
          {!claims.length && <p className="p-6 text-sm text-muted">No claims yet.</p>}
        </div>
      </section>

      <aside className="card h-fit p-5">
        <h2 className="font-display text-xl font-bold uppercase">Log a claim</h2>
        {!claimRules.length ? (
          <p className="mt-2 text-sm text-muted">Add a &quot;Manual claim&quot; rule on the Rules tab first.</p>
        ) : !teams.length ? (
          <p className="mt-2 text-sm text-muted">Create teams first.</p>
        ) : (
          <form action={addClaim.bind(null, id)} className="mt-4 space-y-3">
            <label className="block">
              <span className="label">Type</span>
              <select name="ruleId" className="input">
                {claimRules.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label">Team</span>
              <select name="teamId" className="input">
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label">Hospital / entity</span>
              <input name="entityName" className="input" required />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="label">Product group</span>
                <select name="groupId" className="input">
                  {ruleset.productGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="label">Date</span>
                <input name="date" type="date" className="input" required min={campaign.startDate} max={campaign.endDate} />
              </label>
            </div>
            <label className="block">
              <span className="label">Evidence (link or note)</span>
              <textarea name="evidence" className="input" rows={2} />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="status" value="approved" /> Approve immediately
            </label>
            <button className="btn btn-primary w-full justify-center">Save claim</button>
          </form>
        )}
      </aside>
    </div>
  );
}
