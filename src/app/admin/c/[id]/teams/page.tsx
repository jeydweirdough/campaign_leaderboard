import { and, eq, gte, lte } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/lib/db";
import { getCampaign } from "@/lib/score";
import { deleteTeam, saveTeam } from "../../../actions";

export const dynamic = "force-dynamic";

type Team = typeof schema.teams.$inferSelect;

export default async function TeamsPage({ params }: PageProps<"/admin/c/[id]/teams">) {
  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) notFound();
  const teams = await db.query.teams.findMany({ where: eq(schema.teams.campaignId, id), orderBy: schema.teams.name });

  // Salespersons seen on cached invoices in the campaign window.
  const rows = await db
    .selectDistinct({ id: schema.invoices.salespersonId, name: schema.invoices.salespersonName })
    .from(schema.invoices)
    .where(and(gte(schema.invoices.date, campaign.startDate), lte(schema.invoices.date, campaign.endDate)));
  const isDemo = campaign.dataSource === "demo";
  const salespersons = new Map(rows.filter((r) => r.id && r.id.startsWith("demo-") === isDemo).map((r) => [r.id, r.name]));
  for (const t of teams) for (const sp of t.salespersonIds) if (!salespersons.has(sp)) salespersons.set(sp, sp);
  const owner = new Map<string, string>();
  for (const t of teams) for (const sp of t.salespersonIds) owner.set(sp, t.name);
  const sorted = [...salespersons].sort((a, b) => a[1].localeCompare(b[1]));

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-muted">
        A team is an RX CHC + MD Telesales tag team. Link the Zoho salesperson(s) whose invoices should count for the team. Salespersons appear here once a sync finds their focus-product invoices; you can also paste a salesperson ID.
      </p>
      <div className="grid gap-4 xl:grid-cols-2">
        {teams.map((t) => (
          <TeamForm key={t.id} campaignId={id} team={t} salespersons={sorted} owner={owner} />
        ))}
        <TeamForm campaignId={id} salespersons={sorted} owner={owner} />
      </div>
    </div>
  );
}

function TeamForm({ campaignId, team, salespersons, owner }: { campaignId: string; team?: Team; salespersons: [string, string][]; owner: Map<string, string> }) {
  return (
    <form action={saveTeam.bind(null, campaignId)} className={`card p-4 ${team ? "" : "border-dashed"}`}>
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-bold uppercase">{team ? team.name : "+ New team"}</h3>
        {team && (
          <button formAction={deleteTeam.bind(null, campaignId, team.id)} className="btn btn-sm btn-danger" formNoValidate>
            Delete
          </button>
        )}
      </div>
      {team && <input type="hidden" name="id" value={team.id} />}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label>
          <span className="label">Team name</span>
          <input name="name" className="input" defaultValue={team?.name} required />
        </label>
        <label>
          <span className="label">Region</span>
          <input name="region" className="input" defaultValue={team?.region} />
        </label>
        <label>
          <span className="label">RX CHC</span>
          <input name="chcName" className="input" defaultValue={team?.chcName} />
        </label>
        <label>
          <span className="label">MD Telesales partner</span>
          <input name="mdName" className="input" defaultValue={team?.mdName} />
        </label>
      </div>
      <span className="label mt-3">Zoho salespersons</span>
      <div className="max-h-44 space-y-1 overflow-auto rounded-md border border-line p-2 text-sm">
        {salespersons.map(([spId, name]) => {
          const taken = owner.get(spId);
          const mine = team?.salespersonIds.includes(spId);
          return (
            <label key={spId} className="flex items-center gap-2">
              <input type="checkbox" name="salespersonIds" value={spId} defaultChecked={mine} />
              <span>{name}</span>
              {taken && !mine && <span className="text-xs text-accent">(on {taken})</span>}
            </label>
          );
        })}
        {!salespersons.length && <p className="text-xs text-muted">No salespersons found yet — run a sync first.</p>}
      </div>
      <input name="salespersonIds" className="input mt-2" placeholder="…or paste a Zoho salesperson_id" />
      <button className="btn btn-primary mt-3">{team ? "Save team" : "Add team"}</button>
    </form>
  );
}
