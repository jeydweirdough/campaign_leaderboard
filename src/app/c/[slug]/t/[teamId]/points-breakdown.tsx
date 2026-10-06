import { ChevronRight, Database, FileText, History, Info, ShieldCheck } from "lucide-react";
import type { OrderBasis, ScoreEvent } from "@/lib/rules/engine";
import type { Ruleset } from "@/lib/rules/schema";
import { missionIconAt } from "@/components/mission-icon";
import { fmtDate, num, peso, timeAgo } from "@/lib/format";

type Props = {
  events: ScoreEvent[];
  ruleset: Ruleset;
  /** Admins see full doctor/customer names and claim evidence. */
  reveal: boolean;
  basis: {
    period: string;
    lastSyncedAt: string | null;
    salespersons: string[];
    excludedStatuses: string[];
    dataSource: "zoho" | "demo";
  };
};

/** "Jane Frances Retiro" -> "Dr. Jane R." on public pages. */
function doctorLabel(name: string, reveal: boolean) {
  const clean = name.replace(/^\s*(dr|dra|doc)\.?\s+/i, "").trim();
  if (reveal) return `Dr. ${clean}`;
  const parts = clean.split(/\s+/);
  return parts.length > 1 ? `Dr. ${parts[0]} ${parts[parts.length - 1][0]}.` : `Dr. ${parts[0]}`;
}

export function PointsBreakdown({ events, ruleset, reveal, basis }: Props) {
  const ruleOrder = new Map(ruleset.rules.map((r, i) => [r.id, i]));
  const missions = [...ruleset.missions, { id: "__adjust", name: "Management adjustments", subtitle: "", color: "#8e949c" }];

  return (
    <section id="breakdown" className="mt-6 scroll-mt-6">
      <h2 className="text-xl font-bold">Where the points come from</h2>
      <p className="mt-1 text-sm text-muted">Every point below is calculated from the data shown. Tap an item to see the invoice and the formula.</p>

      {/* Data basis */}
      <div className="panel mt-4 grid gap-4 p-5 sm:grid-cols-2">
        <Fact icon={Database} title="Data source">
          {basis.dataSource === "demo" ? "Generated demo data" : "Zoho Books invoices"} · synced {timeAgo(basis.lastSyncedAt)}
        </Fact>
        <Fact icon={FileText} title="Invoices counted">
          Dated {basis.period}, containing at least one focus product. Ignored: {basis.excludedStatuses.join(", ")} invoices and any invoice excluded by management.
        </Fact>
        <Fact icon={ShieldCheck} title="Credited to this team">
          {basis.salespersons.length ? (
            <>Invoices whose Zoho salesperson is <span className="text-text">{basis.salespersons.join(", ")}</span>.</>
          ) : (
            "No Zoho salesperson linked yet."
          )}
        </Fact>
        <Fact icon={Info} title="Fields used">
          Product lines &amp; amounts · <span className="text-text">Doctor Name</span> ({ruleset.zoho.doctorField}) · <span className="text-text">Source</span> ({ruleset.zoho.sourceField}) · doctor&apos;s earlier invoices in Zoho
        </Fact>
      </div>

      <div className="mt-4 space-y-4">
        {missions.map((m, mi) => {
          const list = events
            .filter((e) => (m.id === "__adjust" ? e.ruleId === "adjustment" : e.missionId === m.id && e.ruleId !== "adjustment"))
            .sort((a, b) => (ruleOrder.get(a.ruleId) ?? 99) - (ruleOrder.get(b.ruleId) ?? 99) || b.date.localeCompare(a.date));
          if (!list.length) return null;
          const Icon = missionIconAt(mi);
          const total = list.reduce((s, e) => s + e.points, 0);
          return (
            <div key={m.id} className="panel overflow-hidden">
              <div className="flex items-center gap-3 border-b border-line px-5 py-4">
                <span className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: `${m.color}22` }}>
                  <Icon className="h-4 w-4" style={{ color: m.color }} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{m.name}</div>
                  {m.subtitle && <div className="text-xs text-muted">{m.subtitle}</div>}
                </div>
                <span className="tnum text-lg font-bold">{num(total)} pts</span>
              </div>
              <ul className="divide-y divide-line">
                {list.map((e, i) => (
                  <li key={i}>
                    <details className="group">
                      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3 text-sm hover:bg-surface-2/50 [&::-webkit-details-marker]:hidden">
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-90" />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">
                            {e.label}
                            {e.invoiceNumber && <span className="font-normal text-muted"> · {e.invoiceNumber}</span>}
                            {!e.invoiceNumber && e.basis.invoices && <span className="font-normal text-muted"> · {e.basis.invoices.length} invoice{e.basis.invoices.length === 1 ? "" : "s"}</span>}
                          </div>
                          <div className="truncate text-xs text-muted group-open:hidden">{e.calc}</div>
                        </div>
                        <span className="tnum shrink-0 text-xs text-muted">{fmtDate(e.date)}</span>
                        <span className={`tnum w-14 shrink-0 text-right font-semibold ${e.points < 0 ? "text-bad" : "text-accent"}`}>
                          {e.points > 0 ? "+" : ""}
                          {num(e.points)}
                        </span>
                      </summary>
                      <EventDetail event={e} reveal={reveal} />
                    </details>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {!events.length && <p className="panel p-6 text-sm text-muted">No points yet — nothing to break down.</p>}
      </div>
    </section>
  );
}

function Fact({ icon: Icon, title, children }: { icon: typeof Info; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
      <div className="min-w-0">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</div>
        <div className="mt-0.5 text-sm text-muted">{children}</div>
      </div>
    </div>
  );
}

function EventDetail({ event: e, reveal }: { event: ScoreEvent; reveal: boolean }) {
  const b = e.basis;
  const many = (b.invoices?.length ?? 0) > 1;
  return (
    <div className="space-y-3 bg-bg/40 px-5 pb-4 pt-1 text-sm sm:pl-12">
      <div className="rounded-lg border border-line bg-surface-2/60 px-3 py-2 font-mono text-xs leading-relaxed">{e.calc}</div>

      {b.history && (
        <div className="flex gap-2 text-xs text-muted">
          <History className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Doctor history checked in Zoho for invoices before <span className="text-text">{b.history.checkedBefore}</span>:{" "}
            {b.history.lastDate ? (
              <>
                last one was <span className="text-text">{b.history.lastNumber ?? "an invoice"}</span> on <span className="text-text">{b.history.lastDate}</span>
                {b.history.gapMonths !== undefined && <> ({b.history.gapMonths} months earlier)</>}
                {b.history.matchedName && b.history.confidence !== "exact" && (
                  <>
                    {" "}— matched as &ldquo;{reveal ? b.history.matchedName : doctorLabel(b.history.matchedName, false)}&rdquo;
                    {b.history.pendingReview && <span className="text-accent"> (possible match — awaiting admin review)</span>}
                  </>
                )}
                .
              </>
            ) : (
              <span className="text-text">none found</span>
            )}
          </span>
        </div>
      )}

      {b.customerHistory && (
        <div className="flex gap-2 text-xs text-muted">
          <History className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Customer checked in Zoho for invoices in the {b.customerHistory.months} months before{" "}
            <span className="text-text">{b.customerHistory.checkedBefore}</span>:{" "}
            {b.customerHistory.lastDate ? (
              <>
                last one was <span className="text-text">{b.customerHistory.lastNumber}</span> on <span className="text-text">{b.customerHistory.lastDate}</span>, outside the window.
              </>
            ) : (
              <span className="text-text">none found — new customer</span>
            )}
          </span>
        </div>
      )}

      {b.history?.aliases && (
        <div className="text-xs text-muted">
          Also written as: {b.history.aliases.map((a) => `"${reveal ? a : doctorLabel(a, false)}"`).join(", ")} — counted as one doctor.
        </div>
      )}

      {b.related && b.related.length > 0 && (
        <div className="text-xs text-muted">
          Earlier orders this month: {b.related.map((r) => `${r.number} (${fmtDate(r.date)})`).join(", ")}
        </div>
      )}

      {b.claim && (
        <div className="text-xs text-muted">
          Claim for <span className="text-text">{b.claim.entity}</span> ({b.claim.group}) · approved by management
          {b.claim.evidence && (reveal ? <> · evidence: <span className="text-text">{b.claim.evidence}</span></> : <> · evidence on file</>)}
        </div>
      )}

      {b.invoices && (many ? <InvoiceTable invoices={b.invoices} /> : b.invoices.map((inv) => <InvoiceCard key={inv.id} inv={inv} reveal={reveal} showCustomer={!!b.showCustomer} />))}
    </div>
  );
}

function InvoiceCard({ inv, reveal, showCustomer }: { inv: OrderBasis; reveal: boolean; showCustomer: boolean }) {
  const rows: [string, React.ReactNode][] = [
    ["Invoice", <span key="n" className="font-medium text-text">{inv.number}</span>],
    ["Date", inv.date],
    ["Status", inv.status],
    ["Source", inv.source || "—"],
    ["Salesperson", inv.salesperson || "—"],
    ["Doctor", inv.doctor ? doctorLabel(inv.doctor, reveal) : "None on invoice"],
  ];
  if (showCustomer || reveal) rows.push(["Customer", inv.customer]);
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 p-3 text-xs sm:grid-cols-3">
        {rows.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-muted">{k}</dt>
            <dd className="truncate">{v}</dd>
          </div>
        ))}
      </dl>
      <table className="w-full border-t border-line text-xs">
        <tbody className="divide-y divide-line">
          {inv.focusLines.map((l, i) => (
            <tr key={i}>
              <td className="px-3 py-1.5">{l.name}</td>
              <td className="px-3 py-1.5 text-muted">{l.group}</td>
              <td className="tnum px-3 py-1.5 text-right">{peso(l.amount)}</td>
            </tr>
          ))}
          <tr className="bg-surface-2/50 font-medium">
            <td className="px-3 py-1.5" colSpan={2}>
              Focus-product total{inv.total !== inv.focusTotal && <span className="font-normal text-muted"> (invoice total {peso(inv.total)})</span>}
            </td>
            <td className="tnum px-3 py-1.5 text-right">{peso(inv.focusTotal)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function InvoiceTable({ invoices }: { invoices: OrderBasis[] }) {
  const sum = invoices.reduce((s, i) => s + i.focusTotal, 0);
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[480px] text-xs">
        <thead className="text-left text-muted">
          <tr className="border-b border-line">
            <th className="px-3 py-2 font-medium">Invoice</th>
            <th className="px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Products</th>
            <th className="px-3 py-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {invoices.map((inv) => (
            <tr key={inv.id}>
              <td className="px-3 py-1.5 font-medium">{inv.number}</td>
              <td className="tnum px-3 py-1.5 text-muted">{fmtDate(inv.date)}</td>
              <td className="px-3 py-1.5 text-muted">{inv.focusLines.map((l) => l.name).join(", ")}</td>
              <td className="tnum px-3 py-1.5 text-right">{peso(inv.focusTotal)}</td>
            </tr>
          ))}
          <tr className="bg-surface-2/50 font-medium">
            <td className="px-3 py-1.5" colSpan={3}>Total counted</td>
            <td className="tnum px-3 py-1.5 text-right">{peso(sum)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
