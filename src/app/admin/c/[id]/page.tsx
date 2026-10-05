import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/lib/db";
import { getCampaign, scoreCampaign } from "@/lib/score";
import { fmtDate, num, peso, timeAgo } from "@/lib/format";
import { SyncButton } from "./sync-button";
import { createTeamFromSalesperson, excludeInvoice } from "../../actions";

export const dynamic = "force-dynamic";

export default async function Overview({ params, searchParams }: PageProps<"/admin/c/[id]">) {
  const { id } = await params;
  const { team: teamFilter, rule: ruleFilter } = await searchParams;
  const campaign = await getCampaign(id);
  if (!campaign) notFound();
  const { ruleset, result } = await scoreCampaign(campaign);
  const lastLog = await db.query.syncLogs.findFirst({ where: eq(schema.syncLogs.campaignId, id), orderBy: desc(schema.syncLogs.id) });
  const pendingClaims = (await db.query.claims.findMany({ where: eq(schema.claims.campaignId, id) })).filter((c) => c.status === "pending").length;
  const teamName = new Map(result.teams.map((t) => [t.team.id, t.team.name]));
  const ruleLabel = new Map(ruleset.rules.map((r) => [r.id, r.label]));
  const events = result.events.filter((e) => (!teamFilter || e.teamId === teamFilter) && (!ruleFilter || e.ruleId === ruleFilter));
  const w = result.warnings;

  return (
    <div className="space-y-8">
      <div className="grid gap-4 md:grid-cols-[1fr_auto]">
        <div className="card p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-xl font-bold uppercase">Data sync</h2>
              <p className="text-sm text-muted">
                Last synced {timeAgo(campaign.lastSyncedAt)}
                {lastLog && !lastLog.ok && <span className="text-bad"> · last run had errors</span>}
              </p>
              <p className="mt-1 text-xs text-muted">
                Pulls invoices containing focus products for the campaign period, then checks each doctor&apos;s prior Zoho invoice history.
              </p>
            </div>
            {campaign.dataSource === "zoho" && <SyncButton campaignId={id} />}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Kpi label="Teams" value={result.teams.length} />
          <Kpi label="Scoring events" value={result.events.length} />
          <Kpi label="Pending claims" value={pendingClaims} href={`/admin/c/${id}/claims`} />
        </div>
      </div>

      {(w.unmappedSalespersons.length > 0 || w.doctorsMissingHistory.length > 0 || w.customersMissingHistory.length > 0) && (
        <section className="card border-accent/50 p-5">
          <h2 className="font-display text-xl font-bold uppercase text-accent">Needs attention</h2>
          {w.unmappedSalespersons.length > 0 && (
            <>
              <p className="mt-2 text-sm text-muted">
                These Zoho salespersons sold focus products but aren&apos;t assigned to a team, so their invoices don&apos;t score yet. Create a team, or add them to an existing team on the{" "}
                <Link href={`/admin/c/${id}/teams`} className="text-accent underline">Teams</Link> tab.
              </p>
              <table className="mt-3 w-full text-sm">
                <tbody className="divide-y divide-line">
                  {w.unmappedSalespersons.map((u) => (
                    <tr key={u.id}>
                      <td className="py-2 font-semibold">{u.name || u.id}</td>
                      <td className="tnum py-2 text-muted">{u.invoices} invoices</td>
                      <td className="tnum py-2 text-muted">{peso(u.focusSales)}</td>
                      <td className="py-2 text-right">
                        <form action={createTeamFromSalesperson.bind(null, id, u.id, u.name)}>
                          <button className="btn btn-sm">Create team</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {w.customersMissingHistory.length > 0 && (
            <p className="mt-3 text-sm text-muted">
              {w.customersMissingHistory.length} hospital(s) have no 6-month look-back yet, so their Hospital PO points are on hold: {w.customersMissingHistory.join(", ")}. Run a sync.
            </p>
          )}
          {w.doctorsMissingHistory.length > 0 && (
            <p className="mt-3 text-sm text-muted">
              {w.doctorsMissingHistory.length} doctor(s) have no history lookup yet, so New/Reactivation points are on hold for them. Run a sync.
            </p>
          )}
        </section>
      )}

      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold uppercase">Scoring audit</h2>
            <p className="text-sm text-muted">Every point awarded, with its source. Exclude an invoice to void all points from it.</p>
          </div>
          <form className="flex gap-2">
            <select name="team" defaultValue={String(teamFilter ?? "")} className="input w-auto">
              <option value="">All teams</option>
              {result.teams.map((t) => (
                <option key={t.team.id} value={t.team.id}>{t.team.name}</option>
              ))}
            </select>
            <select name="rule" defaultValue={String(ruleFilter ?? "")} className="input w-auto">
              <option value="">All rules</option>
              {ruleset.rules.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
              <option value="adjustment">Adjustments</option>
            </select>
            <button className="btn">Filter</button>
          </form>
        </div>
        <div className="card mt-3 overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted">
              <tr className="border-b border-line">
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Team</th>
                <th className="px-3 py-2">Rule</th>
                <th className="px-3 py-2">Detail</th>
                <th className="px-3 py-2">Invoice</th>
                <th className="px-3 py-2 text-right">Pts</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {events.slice(0, 500).map((e, i) => (
                <tr key={i}>
                  <td className="tnum px-3 py-2 text-muted">{fmtDate(e.date)}</td>
                  <td className="px-3 py-2">{teamName.get(e.teamId)}</td>
                  <td className="px-3 py-2">{ruleLabel.get(e.ruleId) ?? e.label}</td>
                  <td className="px-3 py-2 text-muted">
                    {e.detail}
                    <span className="block font-mono text-[11px] text-muted">{e.calc}</span>
                    {e.customerName && e.invoiceId && <span className="block text-xs">{e.customerName}</span>}
                  </td>
                  <td className="tnum px-3 py-2 text-xs">{e.invoiceNumber ?? "—"}</td>
                  <td className={`tnum px-3 py-2 text-right font-bold ${e.points < 0 ? "text-bad" : ""}`}>{num(e.points)}</td>
                  <td className="px-3 py-2 text-right">
                    {e.invoiceId && (
                      <form action={excludeInvoice.bind(null, id)}>
                        <input type="hidden" name="invoiceId" value={e.invoiceId} />
                        <input type="hidden" name="reason" value={`Excluded from audit (${e.invoiceNumber})`} />
                        <button className="btn btn-sm btn-danger" title="Exclude this invoice from all scoring">Exclude</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
              {!events.length && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted">No scoring events yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {events.length > 500 && <p className="mt-2 text-xs text-muted">Showing the 500 most recent of {events.length}. Use filters to narrow.</p>}
      </section>
    </div>
  );
}

function Kpi({ label, value, href }: { label: string; value: number; href?: string }) {
  const body = (
    <div className="card h-full min-w-28 p-4 text-center">
      <div className="font-display tnum text-3xl font-extrabold">{value}</div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
