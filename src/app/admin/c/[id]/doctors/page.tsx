import Link from "next/link";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Check, HelpCircle, Search, Undo2, X } from "lucide-react";
import { db, schema } from "@/lib/db";
import { getCampaign, scoreCampaign } from "@/lib/score";
import { fmtDate } from "@/lib/format";
import { decideDoctorMatch } from "../../../actions";

export const dynamic = "force-dynamic";

type Match = typeof schema.doctorMatches.$inferSelect;

const FILTERS = [
  ["review", "Needs review"],
  ["auto", "Auto-matched"],
  ["decided", "Decided"],
  ["all", "All"],
] as const;

export default async function DoctorsPage({ params, searchParams }: PageProps<"/admin/c/[id]/doctors">) {
  const { id } = await params;
  const sp = await searchParams;
  const filter = (FILTERS.find(([k]) => k === sp.show)?.[0] ?? "review") as (typeof FILTERS)[number][0];
  const q = String(sp.q ?? "").trim().toLowerCase();
  const campaign = await getCampaign(id);
  if (!campaign) notFound();

  // Matches that involve a doctor from this campaign (decisions themselves are global).
  const [history, allMatches, { result }] = await Promise.all([
    db.query.doctorHistory.findMany({ where: eq(schema.doctorHistory.campaignId, id) }),
    db.select().from(schema.doctorMatches),
    scoreCampaign(campaign),
  ]);
  const campaignKeys = new Set(history.map((h) => h.doctorKey));
  const relevant = allMatches.filter((m) => m.campaignId === id || campaignKeys.has(m.keyA) || campaignKeys.has(m.keyB));
  const counts = {
    review: relevant.filter((m) => m.decision === "pending" && m.level === "possible").length,
    auto: relevant.filter((m) => m.decision === "pending" && m.level === "same").length,
    decided: relevant.filter((m) => m.decision !== "pending").length,
    all: relevant.length,
  };
  const shown = relevant
    .filter((m) =>
      filter === "review" ? m.decision === "pending" && m.level === "possible"
      : filter === "auto" ? m.decision === "pending" && m.level === "same"
      : filter === "decided" ? m.decision !== "pending"
      : true,
    )
    .filter((m) => !q || `${m.nameA} ${m.nameB}`.toLowerCase().includes(q))
    .sort((a, b) => (b.decidedAt ?? b.createdAt).localeCompare(a.decidedAt ?? a.createdAt));

  return (
    <div className="space-y-5">
      <div className="max-w-3xl text-sm text-muted">
        Doctor names in Zoho are typed by hand, so the same doctor can appear as &ldquo;Dr. Audie V. Cuntapay&rdquo; and &ldquo;Audie Cuntapay&rdquo;. The matcher
        pairs up spellings that look like the same person. <strong className="text-text">Likely same</strong> pairs are applied automatically;{" "}
        <strong className="text-text">Possible</strong> pairs (surname only, an initial, a typo, different middle names) are treated as the same doctor until you
        decide. Your verdict re-scores New Doctor / Comeback / Back-to-Back points immediately and applies to every campaign.
      </div>

      {result.warnings.doctorsPendingReview.length > 0 && (
        <p className="card border-accent/50 px-4 py-3 text-sm">
          <HelpCircle className="mr-1.5 inline h-4 w-4 text-accent" />
          Points for <strong>{result.warnings.doctorsPendingReview.join(", ")}</strong> depend on a match below that nobody has reviewed yet.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(([key, label]) => (
          <Link
            key={key}
            href={`?show=${key}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${filter === key ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-text"}`}
          >
            {label} <span className="opacity-60">{counts[key]}</span>
          </Link>
        ))}
        <form className="relative ml-auto">
          <input type="hidden" name="show" value={filter} />
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input name="q" defaultValue={q} placeholder="Search a doctor" className="input w-56 rounded-full pl-9" />
        </form>
      </div>

      <div className="card divide-y divide-line">
        {shown.map((m) => (
          <MatchRow key={`${m.keyA}|${m.keyB}`} m={m} campaignId={id} />
        ))}
        {!shown.length && (
          <p className="p-8 text-center text-sm text-muted">
            {filter === "review" ? "Nothing to review — every possible match has a verdict." : "No matches here."}
            {!relevant.length && " Run a sync to look for spelling variants."}
          </p>
        )}
      </div>
    </div>
  );
}

function MatchRow({ m, campaignId }: { m: Match; campaignId: string }) {
  const decide = (d: "same" | "different" | "pending") => decideDoctorMatch.bind(null, campaignId, m.keyA, m.keyB, d);
  return (
    <div className="grid gap-3 p-4 md:grid-cols-[1fr_auto] md:items-center">
      <div className="min-w-0">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
          <NameCell name={m.nameA} ev={m.evidence.a} />
          <span className="hidden text-center text-muted sm:block">≟</span>
          <NameCell name={m.nameB} ev={m.evidence.b} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className={`rounded-full px-2 py-0.5 font-semibold ${m.level === "same" ? "bg-good/15 text-good" : "bg-accent-soft text-accent"}`}>
            {m.level === "same" ? "Likely same" : "Possible"}
          </span>
          <span className="text-muted">{m.reason}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {m.decision === "pending" ? (
          <>
            <form action={decide("same")}>
              <button className="btn btn-sm text-good"><Check className="h-3.5 w-3.5" /> Same doctor</button>
            </form>
            <form action={decide("different")}>
              <button className="btn btn-sm text-bad"><X className="h-3.5 w-3.5" /> Different</button>
            </form>
          </>
        ) : (
          <>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${m.decision === "same" ? "bg-good/15 text-good" : "bg-bad/15 text-bad"}`}>
              {m.decision === "same" ? "Confirmed same" : "Confirmed different"}
            </span>
            <form action={decide("pending")}>
              <button className="btn btn-sm" title="Undo verdict"><Undo2 className="h-3.5 w-3.5" /></button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function NameCell({ name, ev }: { name: string; ev?: { number: string; date: string } }) {
  return (
    <div className="min-w-0 rounded-lg bg-surface-2 px-3 py-2">
      <div className="truncate font-semibold">{name}</div>
      {ev && <div className="truncate text-xs text-muted">{ev.number} · {fmtDate(ev.date)}</div>}
    </div>
  );
}
