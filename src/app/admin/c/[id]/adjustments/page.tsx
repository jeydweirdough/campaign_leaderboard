import { desc, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/lib/db";
import { getCampaign } from "@/lib/score";
import { parseRuleset } from "@/lib/rules/schema";
import { fmtDate, num, peso } from "@/lib/format";
import { addAdjustment, deleteAdjustment, includeInvoice } from "../../../actions";

export const dynamic = "force-dynamic";

export default async function AdjustmentsPage({ params }: PageProps<"/admin/c/[id]/adjustments">) {
  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) notFound();
  const ruleset = parseRuleset(campaign.ruleset);
  const [teams, adjustments, exclusions] = await Promise.all([
    db.query.teams.findMany({ where: eq(schema.teams.campaignId, id), orderBy: schema.teams.name }),
    db.query.adjustments.findMany({ where: eq(schema.adjustments.campaignId, id), orderBy: desc(schema.adjustments.createdAt) }),
    db.query.exclusions.findMany({ where: eq(schema.exclusions.campaignId, id), orderBy: desc(schema.exclusions.createdAt) }),
  ]);
  const invoices = exclusions.length
    ? await db.select().from(schema.invoices).where(inArray(schema.invoices.id, exclusions.map((e) => e.invoiceId)))
    : [];
  const invById = new Map(invoices.map((i) => [i.id, i]));
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const missionName = new Map(ruleset.missions.map((m) => [m.id, m.name]));

  return (
    <div className="space-y-10">
      <section className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div>
          <h2 className="font-display text-2xl font-bold uppercase">Point adjustments</h2>
          <p className="mb-3 text-sm text-muted">Management corrections found during validation. Use negative numbers to deduct.</p>
          <div className="card divide-y divide-line">
            {adjustments.map((a) => (
              <div key={a.id} className="flex items-center gap-3 p-3 text-sm">
                <span className={`tnum font-display w-16 text-xl font-bold ${a.points < 0 ? "text-bad" : "text-good"}`}>
                  {a.points > 0 ? "+" : ""}
                  {num(a.points)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{teamName.get(a.teamId)}</div>
                  <div className="text-xs text-muted">
                    {a.missionId ? missionName.get(a.missionId) : "No mission"} · {a.reason}
                  </div>
                </div>
                <form action={deleteAdjustment.bind(null, id, a.id)}>
                  <button className="btn btn-sm btn-danger">Remove</button>
                </form>
              </div>
            ))}
            {!adjustments.length && <p className="p-6 text-sm text-muted">No adjustments.</p>}
          </div>
        </div>
        <form action={addAdjustment.bind(null, id)} className="card h-fit space-y-3 p-5">
          <h3 className="font-display text-xl font-bold uppercase">Add adjustment</h3>
          <label className="block">
            <span className="label">Team</span>
            <select name="teamId" className="input" required>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label">Mission</span>
            <select name="missionId" className="input">
              {ruleset.missions.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              <option value="">— none —</option>
            </select>
          </label>
          <label className="block">
            <span className="label">Points (+/-)</span>
            <input name="points" type="number" step="any" className="input" required />
          </label>
          <label className="block">
            <span className="label">Reason</span>
            <input name="reason" className="input" required />
          </label>
          <button className="btn btn-primary w-full justify-center" disabled={!teams.length}>Add</button>
        </form>
      </section>

      <section>
        <h2 className="font-display text-2xl font-bold uppercase">Excluded invoices</h2>
        <p className="mb-3 text-sm text-muted">Cancelled, split, duplicate or invalid transactions. Exclude from the Overview audit table.</p>
        <div className="card divide-y divide-line">
          {exclusions.map((e) => {
            const inv = invById.get(e.invoiceId);
            return (
              <div key={e.invoiceId} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{inv?.number ?? e.invoiceId}</div>
                  <div className="text-xs text-muted">
                    {inv ? `${fmtDate(inv.date)} · ${inv.customerName} · ${peso(inv.total)} · ` : ""}
                    {e.reason}
                  </div>
                </div>
                <form action={includeInvoice.bind(null, id, e.invoiceId)}>
                  <button className="btn btn-sm">Restore</button>
                </form>
              </div>
            );
          })}
          {!exclusions.length && <p className="p-6 text-sm text-muted">No excluded invoices.</p>}
        </div>
      </section>
    </div>
  );
}
