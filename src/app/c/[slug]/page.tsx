import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Activity, Award, Building2, Flame, Gift, Stethoscope, Star, Users, type LucideIcon } from "lucide-react";
import { getCampaignBySlug, scoreCampaign } from "@/lib/score";
import { isAdmin } from "@/lib/admin";
import { AutoRefresh } from "@/components/auto-refresh";
import { Countdown } from "@/components/countdown";
import { Medal } from "@/components/medal";
import { PublicShell } from "@/components/public-shell";
import { ShareButton } from "@/components/share-button";
import { publicBaseUrl } from "@/lib/public-url";
import { TeamAvatar } from "@/components/team-avatar";
import { RankingBoard } from "./ranking-board";
import { RecentPlays } from "./recent-plays";
import { daysLeft, fmtRange, manilaToday, num, peso, pesoCompact, timeAgo } from "@/lib/format";
import { RULE_TYPE_LABELS, type Rule, type Ruleset } from "@/lib/rules/schema";
import type { ScoreResult, TeamScore } from "@/lib/rules/engine";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/c/[slug]">): Promise<Metadata> {
  const c = await getCampaignBySlug((await params).slug);
  return { title: c?.name ?? "Leaderboard" };
}

const MISSION_ICONS: LucideIcon[] = [Flame, Stethoscope, Building2, Star];
const missionIcon = (ruleset: Ruleset, id: string | null) => MISSION_ICONS[Math.max(0, ruleset.missions.findIndex((m) => m.id === id)) % MISSION_ICONS.length];
/** "RX CHC + MD Telesales partner"; a team with an MD but no CHC is a vacant slot. */
const subtitle = (s: TeamScore) =>
  s.team.mdName ? `${s.team.chcName || "Vacant"} + ${s.team.mdName}` : s.team.chcName || s.team.region || "";

export default async function LeaderboardPage({ params }: PageProps<"/c/[slug]">) {
  const { slug } = await params;
  const campaign = await getCampaignBySlug(slug);
  if (!campaign) notFound();
  if (campaign.status === "draft" && !(await isAdmin())) notFound();

  // Yesterday's standings (Manila calendar) give the ▲▼ movement in the ranking table.
  const today = manilaToday();
  const lastDay = today < campaign.endDate ? today : campaign.endDate;
  const yesterday = new Date(Date.parse(lastDay) - 86_400_000).toISOString().slice(0, 10);
  const [{ ruleset, result }, previous] = await Promise.all([
    scoreCampaign(campaign),
    yesterday >= campaign.startDate ? scoreCampaign(campaign, yesterday) : null,
  ]);
  const prevRank = new Map(previous?.result.teams.map((t) => [t.team.id, t.rank]));
  const left = daysLeft(campaign.endDate);
  const pageUrl = `${await publicBaseUrl()}/c/${slug}`;
  const scoring = result.teams.filter((t) => t.total > 0).length;
  const prizePlaces = ruleset.awards.filter((a) => a.basis.kind === "overall_rank").length;
  const podium = result.teams.slice(0, 3);

  return (
    <PublicShell
      active="leaderboard"
      slug={slug}
      topRight={
        <>
          <ShareButton slug={slug} pageUrl={pageUrl} />
          <span className="hidden text-xs text-muted sm:inline">Updated {timeAgo(campaign.lastSyncedAt)}</span>
          <span className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${left >= 0 && campaign.status === "live" ? "bg-accent-soft text-accent" : "bg-surface text-muted"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${left >= 0 && campaign.status === "live" ? "animate-pulse bg-accent" : "bg-muted"}`} />
            {campaign.status === "draft" ? "Draft preview" : left >= 0 && campaign.status === "live" ? "Live" : "Final"}
          </span>
        </>
      }
    >
      <AutoRefresh seconds={60} />

      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Leaderboard</h1>
      <p className="mt-1 text-sm text-muted">
        {campaign.name} · {fmtRange(campaign.startDate, campaign.endDate)}
      </p>

      {/* Stats */}
      <section className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-[1fr_1fr_2.1fr]">
        <StatCard value={String(result.teams.length)} label="Teams competing" icon={Users} tone="#22a06b" />
        <StatCard value={String(scoring)} label="Teams on the board" icon={Activity} tone="#2f80ed" />
        <div className="panel col-span-2 flex flex-col justify-between gap-4 p-4 sm:p-5 lg:col-span-1">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <p className="text-base font-medium leading-snug sm:text-lg">
              Remaining time for
              <br />
              completion <span aria-hidden>🔥</span>
            </p>
            {left >= 0 ? <Countdown endDate={campaign.endDate} /> : <span className="text-2xl font-bold text-muted">Campaign ended</span>}
          </div>
          <p className="border-t border-line pt-3 text-xs text-muted">
            {prizePlaces ? `Top ${prizePlaces} teams plus special awards win prizes. ` : ""}Scores are provisional until validated by management.
          </p>
        </div>
      </section>

      {/* Podium */}
      <section className="-mx-3 mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-3 pb-1 pt-3 [scrollbar-width:none] md:mx-0 md:grid md:snap-none md:grid-cols-2 md:gap-4 md:overflow-visible md:px-0 md:pt-0 lg:grid-cols-[1.3fr_1fr_1fr]">
        {[0, 1, 2].map((i) => {
          const s = podium[i];
          if (!s || s.total <= 0) {
            return (
              <div key={i} className="panel flex min-h-48 w-[85%] shrink-0 snap-center flex-col md:w-auto items-center justify-center gap-2 border border-dashed border-line p-6 text-center text-muted">
                <Award className="h-7 w-7" />
                <span className="text-sm font-medium">#{i + 1} is up for grabs</span>
              </div>
            );
          }
          const first = i === 0;
          return (
            <Link
              key={s.team.id}
              href={`/c/${slug}/t/${s.team.id}`}
              className={`panel rise-in relative block w-[85%] shrink-0 snap-center p-4 transition sm:p-5 md:w-auto ${first ? "md:col-span-2 lg:col-span-1" : ""} hover:-translate-y-0.5 ${first ? "border-2 border-gold/80" : "border border-transparent hover:border-line"}`}
              style={{ animationDelay: `${i * 60}ms` }}
            >
              {first && (
                <div className="absolute -top-2 right-4">
                  <Medal place={1} size={60} />
                </div>
              )}
              <div className="flex items-center gap-4 pr-16">
                <TeamAvatar name={s.team.name} rank={s.rank} size={first ? 64 : 56} />
                <div className="min-w-0">
                  <div className={`truncate font-semibold ${first ? "text-xl" : "text-lg"}`}>{s.team.name}</div>
                  <div className="truncate text-sm text-muted">{subtitle(s)}</div>
                </div>
              </div>
              <dl className="mt-5 grid grid-cols-3 gap-2">
                <Metric label="Orders" value={num(s.orders)} />
                <Metric label="Focus sales" value={pesoCompact(s.focusSales)} />
                <Metric label="Points" value={num(s.total)} />
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                {ruleset.missions.map((m) => {
                  const Icon = missionIcon(ruleset, m.id);
                  return (
                    <span key={m.id} className="flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-sm" title={m.name}>
                      <Icon className="h-4 w-4" style={{ color: m.color }} />
                      <span className="tnum font-medium">{num(s.byMission[m.id] ?? 0)}</span>
                    </span>
                  );
                })}
              </div>
            </Link>
          );
        })}
      </section>

      {/* Global ranking */}
      <RankingBoard
        meta={{
          slug,
          missions: ruleset.missions,
          rules: ruleset.rules.filter((r) => r.enabled).map((r) => ({ id: r.id, label: r.label, missionId: r.missionId, type: r.type })),
        }}
        overallRank={Object.fromEntries(result.teams.map((t) => [t.team.id, t.rank]))}
        teams={result.teams.map((s) => ({
          id: s.team.id,
          name: s.team.name,
          sub: subtitle(s),
          total: s.total,
          byMission: s.byMission,
          byRule: s.byRule,
          orders: s.orders,
          focusSales: s.focusSales,
          prevRank: prevRank.get(s.team.id) ?? null,
          md: s.team.mdName,
        }))}
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {ruleset.awards.length > 0 && <AwardRace result={result} />}
        <RecentPlays
          missions={ruleset.missions}
          plays={result.events
            .filter((e) => e.points > 0 && e.ruleId !== "adjustment" && ruleset.rules.find((r) => r.id === e.ruleId)?.type !== "sales_rate")
            .slice(0, 60)
            .map((e) => ({ teamName: result.teams.find((t) => t.team.id === e.teamId)?.team.name ?? "", label: e.label, date: e.date, points: e.points, missionId: e.missionId }))}
        />
      </div>

      <HowToScore ruleset={ruleset} />
    </PublicShell>
  );
}

function StatCard({ value, label, icon: Icon, tone }: { value: string; label: string; icon: LucideIcon; tone: string }) {
  return (
    <div className="panel flex items-start justify-between gap-2 p-4 sm:p-5">
      <div className="min-w-0">
        <div className="tnum text-3xl font-bold sm:text-4xl">{value}</div>
        <div className="mt-2 text-xs text-muted sm:mt-3 sm:text-sm">{label}</div>
      </div>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full sm:h-10 sm:w-10" style={{ background: tone }}>
        <Icon className="h-5 w-5 text-white" />
      </span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="tnum mt-1 truncate text-lg font-semibold sm:text-xl">{value}</dd>
    </div>
  );
}

function AwardRace({ result }: { result: ScoreResult }) {
  const teamById = new Map(result.teams.map((t) => [t.team.id, t.team]));
  return (
    <section className="panel p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-xl font-bold"><Gift className="h-5 w-5 text-accent" /> Award race</h2>
      <ul className="mt-4 divide-y divide-line">
        {result.awards.map(({ award, leaders, winnerTeamId }) => {
          const team = winnerTeamId ? teamById.get(winnerTeamId) : null;
          const value = leaders[0]?.value ?? 0;
          return (
            <li key={award.id} className="flex items-center gap-3 py-3">
              {team ? <TeamAvatar name={team.name} size={36} /> : <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-muted"><Award className="h-4 w-4" /></span>}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">
                  {award.title} <span className="font-normal text-muted">· {award.subtitle}</span>
                </div>
                <div className="truncate text-xs text-muted">
                  {team ? `${team.name} · ${award.basis.kind === "max_single_order" ? peso(value) : `${num(value)} pts`}` : "Open — no leader yet"}
                </div>
              </div>
              {award.prize && <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold">{award.prize}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function HowToScore({ ruleset }: { ruleset: Ruleset }) {
  return (
    <section id="how-to-score" className="mt-6 scroll-mt-6">
      <h2 className="text-2xl font-bold tracking-tight">How to score</h2>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {ruleset.missions.map((m) => {
          const rules = ruleset.rules.filter((r) => r.enabled && r.missionId === m.id);
          if (!rules.length) return null;
          const Icon = missionIcon(ruleset, m.id);
          return (
            <div key={m.id} className="panel overflow-hidden">
              <div className="flex items-center gap-3 px-5 pt-5">
                <span className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: `${m.color}22` }}>
                  <Icon className="h-5 w-5" style={{ color: m.color }} />
                </span>
                <div>
                  <div className="font-semibold">{m.name}</div>
                  <div className="text-xs text-muted">{m.subtitle}</div>
                </div>
              </div>
              <ul className="mt-3 divide-y divide-line text-sm">
                {rules.map((r) => (
                  <li key={r.id} className="px-5 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium">{r.label}</span>
                      <span className="shrink-0 text-xs font-semibold text-accent">{rulePointsText(r, ruleset)}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted">{r.description || RULE_TYPE_LABELS[r.type]}</div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="panel mt-4 p-5">
        <div className="font-semibold">Focus products</div>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {ruleset.productGroups
            .toSorted((a, b) => a.rank - b.rank)
            .map((g) => (
              <div key={g.id}>
                <div className="text-xs font-medium uppercase tracking-wide text-muted">{g.name}</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {g.products.map((p) => (
                    <span key={p.name} className="rounded-full bg-surface-2 px-3 py-1 text-xs">{p.name}</span>
                  ))}
                </div>
              </div>
            ))}
        </div>
      </div>
    </section>
  );
}

function rulePointsText(r: Rule, ruleset: Ruleset) {
  const gname = (id: string) => ruleset.productGroups.find((g) => g.id === id)?.name ?? id;
  switch (r.type) {
    case "sales_rate":
      return Object.entries(r.rates)
        .map(([g, rate]) => `${rate.points}/${pesoCompact(rate.per)} ${gname(g)}`)
        .join(" · ");
    case "order_threshold":
      return `+${r.points}`;
    default: {
      const vals = Object.entries(r.points);
      const same = vals.every(([, v]) => v === vals[0]?.[1]);
      return same ? `${vals[0]?.[1] ?? 0} pts` : vals.map(([g, v]) => `${v} ${gname(g)}`).join(" / ");
    }
  }
}
