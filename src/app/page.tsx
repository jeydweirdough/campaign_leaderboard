import Link from "next/link";
import { inArray, desc } from "drizzle-orm";
import { CalendarDays, ChevronRight, Trophy } from "lucide-react";
import { db, schema } from "@/lib/db";
import { daysLeft, fmtRange } from "@/lib/format";
import { PublicShell } from "@/components/public-shell";

export const dynamic = "force-dynamic";

export default async function Home() {
  const campaigns = await db
    .select()
    .from(schema.campaigns)
    .where(inArray(schema.campaigns.status, ["live", "closed"]))
    .orderBy(desc(schema.campaigns.startDate));

  return (
    <PublicShell active="campaigns">
      <h1 className="text-3xl font-bold tracking-tight">Campaigns</h1>
      <p className="mt-1 text-sm text-muted">Live standings for every GetMEDS sales campaign. Scores are provisional until validated by management.</p>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {campaigns.map((c) => {
          const left = daysLeft(c.endDate);
          const live = c.status === "live" && left >= 0;
          return (
            <Link key={c.id} href={`/c/${c.slug}`} className="panel group flex items-center gap-4 p-5 transition hover:-translate-y-0.5">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-soft">
                <Trophy className="h-6 w-6 text-accent" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-lg font-semibold">{c.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${live ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted"}`}>
                    {live ? "Live" : "Final"}
                  </span>
                </div>
                <div className="truncate text-sm text-muted">{c.tagline}</div>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                  <CalendarDays className="h-3.5 w-3.5" /> {fmtRange(c.startDate, c.endDate)}
                  {live && <span className="text-text">· {left === 0 ? "Final day" : `${left} days left`}</span>}
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-muted transition group-hover:text-accent" />
            </Link>
          );
        })}
        {!campaigns.length && <p className="text-muted">No live campaigns yet.</p>}
      </div>
    </PublicShell>
  );
}
