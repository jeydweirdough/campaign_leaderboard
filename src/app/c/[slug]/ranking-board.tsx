"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronsUpDown, ExternalLink, Minus, Search, Star, X } from "lucide-react";
import { TeamAvatar } from "@/components/team-avatar";
import { missionIconAt } from "@/components/mission-icon";

export type BoardTeam = {
  id: string;
  name: string;
  sub: string;
  total: number;
  byMission: Record<string, number>;
  byRule: Record<string, { points: number; count: number }>;
  orders: number;
  focusSales: number;
  prevRank: number | null;
  /** MD Telesales partner — used for the partner filter. */
  md: string;
};

export type BoardMeta = {
  slug: string;
  missions: { id: string; name: string; subtitle: string; color: string }[];
  rules: { id: string; label: string; missionId: string; type: string }[];
};

type SortKey = "points" | "orders" | "focusSales" | "name" | `m:${string}`;

const fmt = (n: number) => n.toLocaleString("en-PH", { maximumFractionDigits: 2 });
const peso = (n: number) => `₱${n.toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;

// ---- "my team" lives in localStorage, read via an external store so SSR stays stable ----
const MY_TEAM_EVENT = "lb:my-team";
function useMyTeam(slug: string) {
  const key = `lb:my-team:${slug}`;
  const value = useSyncExternalStore(
    (cb) => {
      window.addEventListener("storage", cb);
      window.addEventListener(MY_TEAM_EVENT, cb);
      return () => {
        window.removeEventListener("storage", cb);
        window.removeEventListener(MY_TEAM_EVENT, cb);
      };
    },
    () => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    () => null,
  );
  const set = (id: string | null) => {
    try {
      if (id) localStorage.setItem(key, id);
      else localStorage.removeItem(key);
    } catch {
      /* storage unavailable — pin just won't persist */
    }
    window.dispatchEvent(new Event(MY_TEAM_EVENT));
  };
  return [value, set] as const;
}

/** Standard competition ranking ("1, 2, 2, 4") on a value. */
function rankBy(teams: BoardTeam[], value: (t: BoardTeam) => number) {
  const sorted = [...teams].sort((a, b) => value(b) - value(a));
  const ranks = new Map<string, number>();
  sorted.forEach((t, i) => ranks.set(t.id, i > 0 && value(t) === value(sorted[i - 1]) ? ranks.get(sorted[i - 1].id)! : i + 1));
  return ranks;
}

export function RankingBoard({ teams, meta, overallRank }: { teams: BoardTeam[]; meta: BoardMeta; overallRank: Record<string, number> }) {
  const [view, setView] = useState<string>("overall"); // "overall" | missionId
  const [query, setQuery] = useState("");
  const [prefix, setPrefix] = useState<string>("all");
  const [md, setMd] = useState<string>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [hideZero, setHideZero] = useState(false);
  const [myTeam, setMyTeam] = useMyTeam(meta.slug);
  const flash = useFlashOnIncrease(teams);

  const viewValue = (t: BoardTeam) => (view === "overall" ? t.total : (t.byMission[view] ?? 0));
  const viewRank = useMemo(
    () => (view === "overall" ? new Map(Object.entries(overallRank)) : rankBy(teams, (t) => t.byMission[view] ?? 0)),
    [view, teams, overallRank],
  );

  // Group chips from the first word of team names (STC / BNB / URO …) when it's a meaningful split.
  const prefixes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of teams) {
      const p = t.name.split(/\s+/)[0]?.toUpperCase();
      if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    const useful = [...counts].filter(([, n]) => n >= 2);
    return useful.length >= 2 ? useful.map(([p, n]) => ({ p, n })) : [];
  }, [teams]);

  const mdPartners = useMemo(() => [...new Set(teams.map((t) => t.md).filter(Boolean))].sort(), [teams]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = teams.filter(
      (t) =>
        (!q || t.name.toLowerCase().includes(q) || t.sub.toLowerCase().includes(q)) &&
        (prefix === "all" || t.name.split(/\s+/)[0]?.toUpperCase() === prefix) &&
        (md === "all" || t.md === md) &&
        (!hideZero || viewValue(t) > 0),
    );
    const val = (t: BoardTeam): number | string => {
      if (!sort) return -(viewRank.get(t.id) ?? 999);
      if (sort.key === "points") return viewValue(t);
      if (sort.key === "orders") return t.orders;
      if (sort.key === "focusSales") return t.focusSales;
      if (sort.key === "name") return t.name;
      return t.byMission[sort.key.slice(2)] ?? 0;
    };
    const dir = sort?.dir === "asc" ? 1 : -1;
    return list.sort((a, b) => {
      const va = val(a), vb = val(b);
      const c = typeof va === "string" ? va.localeCompare(vb as string) : va - (vb as number);
      return c * (sort ? dir : -1) || a.name.localeCompare(b.name);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams, query, prefix, md, hideZero, sort, view, viewRank]);

  const byRank = useMemo(() => [...teams].sort((a, b) => (viewRank.get(a.id) ?? 0) - (viewRank.get(b.id) ?? 0)), [teams, viewRank]);
  const mine = teams.find((t) => t.id === myTeam);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s?.key === key ? (s.dir === "desc" ? { key, dir: "asc" } : null) : { key, dir: key === "name" ? "asc" : "desc" }));

  const missionIndex = (id: string) => meta.missions.findIndex((m) => m.id === id);
  const viewLabel = view === "overall" ? "Points" : meta.missions.find((m) => m.id === view)?.name ?? "Points";

  return (
    <section className="panel mt-6 p-4 sm:p-7" id="ranking">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Global Ranking</h2>
        {/* View tabs */}
        <div role="tablist" aria-label="Rank by" className="flex max-w-full gap-1 overflow-x-auto rounded-full bg-surface-2 p-1 [scrollbar-width:none]">
          {[{ id: "overall", name: "Overall", color: "" }, ...meta.missions].map((m) => {
            const Icon = m.id === "overall" ? null : missionIconAt(missionIndex(m.id));
            const active = view === m.id;
            return (
              <button
                key={m.id}
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setView(m.id);
                  setSort(null);
                }}
                className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition ${active ? "bg-surface text-text shadow" : "text-muted hover:text-text"}`}
              >
                {Icon && <Icon className="h-4 w-4" style={{ color: m.color }} />}
                {m.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* My team bar */}
      {mine && (
        <MyTeamBar
          team={mine}
          rank={viewRank.get(mine.id) ?? 0}
          above={byRank[byRank.findIndex((t) => t.id === mine.id) - 1]}
          value={viewValue}
          label={viewLabel}
          onJump={() => {
            setExpanded(mine.id);
            // Desktop table row or mobile card — whichever is actually displayed.
            const el = [document.getElementById(`row-${mine.id}`), document.getElementById(`card-${mine.id}`)].find((e) => e?.offsetParent);
            el?.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
          onClear={() => setMyTeam(null)}
        />
      )}

      {/* Filters */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <label className="relative min-w-52 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search team or name"
            aria-label="Search teams"
            className="w-full rounded-full border border-line bg-surface-2 py-2 pl-9 pr-8 text-sm outline-none focus:border-accent"
          />
          {query && (
            <button onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text">
              <X className="h-4 w-4" />
            </button>
          )}
        </label>
        {prefixes.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {[{ p: "all", n: teams.length }, ...prefixes].map(({ p, n }) => (
              <button
                key={p}
                onClick={() => setPrefix(p)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${prefix === p ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-text"}`}
              >
                {p === "all" ? "All" : p} <span className="opacity-60">{n}</span>
              </button>
            ))}
          </div>
        )}
        {mdPartners.length > 1 && (
          <select
            value={md}
            onChange={(e) => setMd(e.target.value)}
            aria-label="Filter by MD Telesales partner"
            className={`rounded-full border bg-surface-2 px-3 py-1.5 text-xs font-semibold outline-none ${md === "all" ? "border-line text-muted" : "border-accent text-accent"}`}
          >
            <option value="all">All MD partners</option>
            {mdPartners.map((m) => (
              <option key={m} value={m}>
                {m} ({teams.filter((t) => t.md === m).length})
              </option>
            ))}
          </select>
        )}
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} className="accent-[var(--accent)]" />
          Hide teams without points
        </label>
      </div>

      {/* Phones: tappable cards */}
      <ul className="mt-4 space-y-2 md:hidden">
        {rows.map((t) => {
          const rank = viewRank.get(t.id) ?? 0;
          const value = viewValue(t);
          const open = expanded === t.id;
          const isMine = myTeam === t.id;
          const medal = value > 0 && rank <= 3 ? ["bg-gold text-black", "bg-silver text-black", "bg-bronze text-black"][rank - 1] : "bg-surface-2 text-text";
          const idx = byRank.findIndex((x) => x.id === t.id);
          return (
            <li
              key={t.id}
              id={`card-${t.id}`}
              className={`overflow-hidden rounded-xl border ${isMine ? "border-gold/50 bg-accent-soft" : "border-line"} ${flash.has(t.id) ? "flash-row" : ""}`}
            >
              <div
                role="button"
                tabIndex={0}
                aria-expanded={open}
                onClick={() => setExpanded(open ? null : t.id)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setExpanded(open ? null : t.id))}
                className="flex cursor-pointer items-center gap-3 p-3"
              >
                <div className="flex w-8 shrink-0 flex-col items-center gap-0.5">
                  <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${medal}`}>{rank}</span>
                  {view === "overall" && <Movement prev={t.prevRank} now={rank} />}
                </div>
                <TeamAvatar name={t.name} size={38} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{t.name}</div>
                  <div className="truncate text-xs text-muted">
                    {t.orders} order{t.orders === 1 ? "" : "s"} · {peso(t.focusSales)}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMyTeam(isMine ? null : t.id);
                  }}
                  aria-label={isMine ? "Unpin my team" : "Pin as my team"}
                  className={`p-1 ${isMine ? "text-gold" : "text-muted/40"}`}
                >
                  <Star className="h-4 w-4" fill={isMine ? "currentColor" : "none"} />
                </button>
                <div className="w-12 text-right">
                  <div className={`tnum text-lg font-bold leading-none ${value === 0 ? "text-muted" : ""}`}>{fmt(value)}</div>
                  <div className="mt-1 text-[10px] uppercase tracking-wide text-muted">pts</div>
                </div>
              </div>
              {open && (
                <div className="border-t border-line p-3">
                  {view === "overall" && (
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {meta.missions.map((m, i) => {
                        const Icon = missionIconAt(i);
                        return (
                          <span key={m.id} className="flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs">
                            <Icon className="h-3.5 w-3.5" style={{ color: m.color }} />
                            <span className="tnum font-semibold">{fmt(t.byMission[m.id] ?? 0)}</span>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <Breakdown team={t} meta={meta} rank={rank} above={byRank[idx - 1]} below={byRank[idx + 1]} value={viewValue} />
                </div>
              )}
            </li>
          );
        })}
        {!rows.length && <li className="py-10 text-center text-sm text-muted">{teams.length ? "No teams match your filters." : "Teams haven't been set up yet."}</li>}
      </ul>

      {/* Tablet/desktop: full table */}
      <div className="mt-4 hidden overflow-x-auto rounded-xl border border-line md:block">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="w-20 px-4 py-4 font-medium">Rank</th>
              <SortTh label="Team" k="name" sort={sort} onSort={toggleSort} />
              {view === "overall" &&
                meta.missions.map((m) => <SortTh key={m.id} label={m.subtitle || m.name} k={`m:${m.id}`} sort={sort} onSort={toggleSort} right />)}
              <SortTh label="Orders" k="orders" sort={sort} onSort={toggleSort} right />
              <SortTh label="Focus sales" k="focusSales" sort={sort} onSort={toggleSort} right />
              <SortTh label={viewLabel} k="points" sort={sort} onSort={toggleSort} right />
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const rank = viewRank.get(t.id) ?? 0;
              const value = viewValue(t);
              const open = expanded === t.id;
              const isMine = myTeam === t.id;
              const medal = value > 0 && rank <= 3 ? ["bg-gold text-black", "bg-silver text-black", "bg-bronze text-black"][rank - 1] : "bg-surface-2 text-text";
              return (
                <Fragment key={t.id}>
                  <tr
                    id={`row-${t.id}`}
                    onClick={() => setExpanded(open ? null : t.id)}
                    className={`cursor-pointer border-t border-line transition-colors first:border-t-0 hover:bg-surface-2/60 ${isMine ? "bg-accent-soft" : ""} ${flash.has(t.id) ? "flash-row" : ""} ${value === 0 ? "text-muted" : ""}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${medal}`}>{rank}</span>
                        {view === "overall" && <Movement prev={t.prevRank} now={rank} />}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <TeamAvatar name={t.name} size={36} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-text">{t.name}</span>
                          <span className="block truncate text-xs text-muted">{t.sub}</span>
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setMyTeam(isMine ? null : t.id);
                          }}
                          aria-label={isMine ? "Unpin my team" : "Pin as my team"}
                          title={isMine ? "Unpin my team" : "This is my team"}
                          className={`ml-1 rounded-full p-1 transition ${isMine ? "text-gold" : "text-muted/40 hover:text-gold"}`}
                        >
                          <Star className="h-4 w-4" fill={isMine ? "currentColor" : "none"} />
                        </button>
                      </div>
                    </td>
                    {view === "overall" && meta.missions.map((m) => <td key={m.id} className="tnum px-4 py-3 text-right">{fmt(t.byMission[m.id] ?? 0)}</td>)}
                    <td className="tnum px-4 py-3 text-right">{fmt(t.orders)}</td>
                    <td className="tnum px-4 py-3 text-right">{peso(t.focusSales)}</td>
                    <td className="tnum px-4 py-3 text-right text-base font-semibold text-text">{fmt(value)}</td>
                    <td className="px-2 py-3 text-muted">
                      <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
                    </td>
                  </tr>
                  {open && (
                    <tr className="bg-bg/40">
                      <td colSpan={99} className="px-4 pb-5 pt-1">
                        <Breakdown team={t} meta={meta} rank={rank} above={byRank[byRank.findIndex((x) => x.id === t.id) - 1]} below={byRank[byRank.findIndex((x) => x.id === t.id) + 1]} value={viewValue} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={99} className="px-4 py-10 text-center text-muted">
                  {teams.length ? "No teams match your filters." : "Teams haven't been set up yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">
        Tap a row for the points breakdown · <Star className="inline h-3 w-3" /> pins your team on this device · ▲▼ shows movement since yesterday
      </p>
    </section>
  );
}

function SortTh({ label, k, sort, onSort, right }: { label: string; k: SortKey; sort: { key: SortKey; dir: "asc" | "desc" } | null; onSort: (k: SortKey) => void; right?: boolean }) {
  const active = sort?.key === k;
  const Icon = !active ? ChevronsUpDown : sort.dir === "desc" ? ArrowDown : ArrowUp;
  return (
    <th className={`px-4 py-4 font-medium ${right ? "text-right" : ""}`} aria-sort={active ? (sort.dir === "desc" ? "descending" : "ascending") : "none"}>
      <button onClick={() => onSort(k)} className={`inline-flex items-center gap-1 transition hover:text-text ${active ? "text-text" : ""}`}>
        {label}
        <Icon className={`h-3.5 w-3.5 ${active ? "" : "opacity-40"}`} />
      </button>
    </th>
  );
}

function Movement({ prev, now }: { prev: number | null; now: number }) {
  if (prev === null) return null;
  const d = prev - now;
  if (d === 0) return <Minus className="h-3.5 w-3.5 text-muted/50" aria-label="No change since yesterday" />;
  return d > 0 ? (
    <span className="flex items-center text-xs font-semibold text-good" title={`Up ${d} since yesterday`}>
      <ArrowUp className="h-3.5 w-3.5" />
      {d}
    </span>
  ) : (
    <span className="flex items-center text-xs font-semibold text-bad" title={`Down ${-d} since yesterday`}>
      <ArrowDown className="h-3.5 w-3.5" />
      {-d}
    </span>
  );
}

function Breakdown({
  team, meta, rank, above, below, value,
}: { team: BoardTeam; meta: BoardMeta; rank: number; above?: BoardTeam; below?: BoardTeam; value: (t: BoardTeam) => number }) {
  return (
    <div className="grid gap-4 rounded-xl bg-surface-2/60 p-4 lg:grid-cols-[1fr_260px]">
      <div className="grid gap-4 sm:grid-cols-3">
        {meta.missions.map((m, i) => {
          const Icon = missionIconAt(i);
          const rules = meta.rules.filter((r) => r.missionId === m.id);
          return (
            <div key={m.id}>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Icon className="h-4 w-4" style={{ color: m.color }} /> {m.name}
                <span className="tnum ml-auto">{fmt(team.byMission[m.id] ?? 0)}</span>
              </div>
              <ul className="mt-2 space-y-1 text-xs">
                {rules.map((r) => {
                  const s = team.byRule[r.id];
                  return (
                    <li key={r.id} className="flex justify-between gap-2 text-muted">
                      <span>
                        {r.label}
                        {r.type !== "sales_rate" && s?.count ? <span className="text-text"> ×{s.count}</span> : null}
                      </span>
                      <span className={`tnum ${s?.points ? "text-text" : ""}`}>{fmt(s?.points ?? 0)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="flex flex-col justify-between gap-3 border-line text-sm lg:border-l lg:pl-4">
        <div className="space-y-1.5">
          {above ? (
            <p>
              <span className="tnum font-semibold text-accent">{fmt(value(above) - value(team))} pts</span> <span className="text-muted">behind #{rank - 1} {above.name}</span>
            </p>
          ) : (
            <p className="font-semibold text-gold">Leading this view 🏆</p>
          )}
          {below && (
            <p className="text-muted">
              <span className="tnum font-semibold text-text">{fmt(value(team) - value(below))} pts</span> ahead of {below.name}
            </p>
          )}
        </div>
        <Link href={`/c/${meta.slug}/t/${team.id}#breakdown`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
          See where the points come from <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}

function MyTeamBar({
  team, rank, above, value, label, onJump, onClear,
}: { team: BoardTeam; rank: number; above?: BoardTeam; value: (t: BoardTeam) => number; label: string; onJump: () => void; onClear: () => void }) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-gold/40 bg-gold/10 px-4 py-3">
      <Star className="h-4 w-4 text-gold" fill="currentColor" />
      <span className="text-sm">
        <span className="font-semibold">{team.name}</span> is <span className="font-semibold">#{rank}</span> with{" "}
        <span className="tnum font-semibold">{fmt(value(team))}</span> {label === "Points" ? "pts" : `pts in ${label}`}
        {above && (
          <span className="text-muted">
            {" "}· <span className="tnum text-text">{fmt(value(above) - value(team))}</span> to overtake {above.name}
          </span>
        )}
      </span>
      <div className="ml-auto flex gap-2">
        <button onClick={onJump} className="btn btn-sm">Show my row</button>
        <button onClick={onClear} className="btn btn-sm" aria-label="Unpin my team">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/** Ids of teams whose total went up since the previous render (e.g. after "Sync now"). */
function useFlashOnIncrease(teams: BoardTeam[]) {
  const prev = useRef<Map<string, number> | null>(null);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const signature = teams.map((t) => `${t.id}:${t.total}`).join("|");

  useEffect(() => {
    const before = prev.current;
    prev.current = new Map(teams.map((t) => [t.id, t.total]));
    if (!before) return;
    const up = new Set(teams.filter((t) => t.total > (before.get(t.id) ?? 0)).map((t) => t.id));
    if (!up.size) return;
    const show = setTimeout(() => setFlash(up), 0);
    const hide = setTimeout(() => setFlash(new Set()), 4000);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return flash;
}
