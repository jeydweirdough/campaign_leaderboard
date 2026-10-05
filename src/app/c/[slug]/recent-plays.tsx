"use client";

import { useState } from "react";
import { ShoppingBag } from "lucide-react";
import { missionIconAt } from "@/components/mission-icon";

export type Play = { teamName: string; label: string; date: string; points: number; missionId: string | null };

const PAGE = 8;

export function RecentPlays({ plays, missions }: { plays: Play[]; missions: { id: string; name: string; color: string }[] }) {
  const [filter, setFilter] = useState("all");
  const [limit, setLimit] = useState(PAGE);
  const list = plays.filter((p) => filter === "all" || p.missionId === filter);
  const idx = (id: string | null) => missions.findIndex((m) => m.id === id);

  return (
    <section className="panel p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <ShoppingBag className="h-5 w-5 text-accent" /> Recent plays
        </h2>
        <div className="flex gap-1">
          {[{ id: "all", name: "All", color: "" }, ...missions].map((m) => {
            const Icon = m.id === "all" ? null : missionIconAt(idx(m.id));
            return (
              <button
                key={m.id}
                onClick={() => {
                  setFilter(m.id);
                  setLimit(PAGE);
                }}
                title={m.name}
                aria-pressed={filter === m.id}
                className={`flex h-8 items-center justify-center rounded-full px-3 text-xs font-semibold transition ${filter === m.id ? "bg-surface-2 text-text" : "text-muted hover:text-text"}`}
              >
                {Icon ? <Icon className="h-4 w-4" style={{ color: m.color }} /> : "All"}
              </button>
            );
          })}
        </div>
      </div>
      <ul className="mt-3 divide-y divide-line">
        {list.slice(0, limit).map((p, i) => {
          const m = missions[idx(p.missionId)];
          const Icon = missionIconAt(idx(p.missionId));
          return (
            <li key={i} className="flex items-center gap-3 py-3 text-sm">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: `${m?.color ?? "#888"}22` }}>
                <Icon className="h-4 w-4" style={{ color: m?.color }} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{p.teamName}</div>
                <div className="truncate text-xs text-muted">
                  {p.label} · {new Date(`${p.date}T00:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}
                </div>
              </div>
              <span className="tnum font-semibold text-accent">+{p.points.toLocaleString("en-PH")}</span>
            </li>
          );
        })}
        {!list.length && <li className="py-6 text-sm text-muted">No plays here yet — new doctors, hospital POs and big orders will show up as they happen.</li>}
      </ul>
      {list.length > limit && (
        <button onClick={() => setLimit((l) => l + PAGE)} className="btn btn-sm mt-3 w-full justify-center">
          Show more ({list.length - limit})
        </button>
      )}
    </section>
  );
}
