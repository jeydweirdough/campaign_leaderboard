import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, Flame, Star, Stethoscope, type LucideIcon } from "lucide-react";
import { getCampaignBySlug, scoreCampaign } from "@/lib/score";
import { isAdmin } from "@/lib/admin";
import { PublicShell } from "@/components/public-shell";
import { TeamAvatar } from "@/components/team-avatar";
import { Medal } from "@/components/medal";
import { fmtRange, num, peso } from "@/lib/format";
import { inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { PointsBreakdown } from "./points-breakdown";

export const dynamic = "force-dynamic";

const MISSION_ICONS: LucideIcon[] = [Flame, Stethoscope, Building2, Star];

export default async function TeamPage({ params }: PageProps<"/c/[slug]/t/[teamId]">) {
  const { slug, teamId } = await params;
  const campaign = await getCampaignBySlug(slug);
  const admin = await isAdmin();
  if (!campaign || (campaign.status === "draft" && !admin)) notFound();
  const { ruleset, result } = await scoreCampaign(campaign);
  const score = result.teams.find((t) => t.team.id === teamId);
  if (!score) notFound();
  const events = result.events.filter((e) => e.teamId === teamId);
  const onPodium = score.total > 0 && score.rank <= 3;
  // Display names of the Zoho salespersons credited to this team.
  const spRows = score.team.salespersonIds.length
    ? await db
        .selectDistinct({ id: schema.invoices.salespersonId, name: schema.invoices.salespersonName })
        .from(schema.invoices)
        .where(inArray(schema.invoices.salespersonId, score.team.salespersonIds))
    : [];
  const salespersons = score.team.salespersonIds.map((id) => spRows.find((r) => r.id === id)?.name || id);

  return (
    <PublicShell active="leaderboard" slug={slug} background={campaign.backgroundImage}>
      <Link href={`/c/${slug}`} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text">
        <ArrowLeft className="h-4 w-4" /> Leaderboard
      </Link>

      <section className={`panel relative mt-4 p-6 ${score.rank === 1 && onPodium ? "border-2 border-gold/80" : ""}`}>
        {onPodium && (
          <div className="absolute -top-2 right-6">
            <Medal place={score.rank as 1 | 2 | 3} size={56} />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-5 pr-16">
          <TeamAvatar name={score.team.name} rank={score.rank} size={76} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-3xl font-bold tracking-tight">{score.team.name}</h1>
            <p className="mt-1 text-sm text-muted">
              {(score.team.chcName || score.team.mdName) && (
                <>RX CHC <span className="text-text">{score.team.chcName || "Vacant"}</span></>
              )}
              {score.team.mdName && <> · MD Telesales <span className="text-text">{score.team.mdName}</span></>}
              {!score.team.chcName && !score.team.mdName && score.team.region}
            </p>
          </div>
        </div>
        <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Metric label="Rank" value={`#${score.rank}`} />
          <Metric label="Points" value={num(score.total)} />
          <Metric label="Orders" value={num(score.orders)} />
          <Metric label="Focus sales" value={peso(score.focusSales)} />
        </dl>
      </section>

      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {ruleset.missions.map((m, i) => {
          const Icon = MISSION_ICONS[i % MISSION_ICONS.length];
          return (
            <div key={m.id} className="panel p-5">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: `${m.color}22` }}>
                  <Icon className="h-5 w-5" style={{ color: m.color }} />
                </span>
                <div>
                  <div className="font-semibold">{m.name}</div>
                  <div className="text-xs text-muted">{m.subtitle}</div>
                </div>
                <div className="tnum ml-auto text-2xl font-bold">{num(score.byMission[m.id] ?? 0)}</div>
              </div>
              <ul className="mt-4 space-y-1.5 text-sm">
                {ruleset.rules
                  .filter((r) => r.missionId === m.id && r.enabled)
                  .map((r) => (
                    <li key={r.id} className="flex justify-between gap-2">
                      <span className="text-muted">
                        {r.label}
                        {r.type !== "sales_rate" && score.byRule[r.id]?.count ? ` ×${score.byRule[r.id].count}` : ""}
                      </span>
                      <span className="tnum font-medium">{num(score.byRule[r.id]?.points ?? 0)}</span>
                    </li>
                  ))}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {ruleset.productGroups.map((g) => (
          <div key={g.id} className="panel flex items-center justify-between p-5">
            <span className="text-sm text-muted">{g.name} sales</span>
            <span className="tnum text-xl font-semibold">{peso(score.groupSales[g.id] ?? 0)}</span>
          </div>
        ))}
      </div>

      <PointsBreakdown
        events={events}
        ruleset={ruleset}
        reveal={admin}
        basis={{
          period: fmtRange(campaign.startDate, campaign.endDate),
          lastSyncedAt: campaign.lastSyncedAt,
          salespersons,
          excludedStatuses: ruleset.zoho.excludedStatuses,
          dataSource: campaign.dataSource,
        }}
      />
    </PublicShell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="tnum mt-1 text-2xl font-semibold">{value}</dd>
    </div>
  );
}
