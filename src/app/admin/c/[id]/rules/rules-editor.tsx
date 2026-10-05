"use client";

import { useState, useTransition } from "react";
import { RULE_TYPE_LABELS, type Award, type Rule, type RuleType, type Ruleset } from "@/lib/rules/schema";
import { saveRuleset, searchZohoItems } from "../../../actions";

type Props = { campaignId: string; initial: Ruleset; sources: string[]; zohoEnabled: boolean };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";
const uid = (base: string) => `${slug(base)}-${Math.random().toString(36).slice(2, 6)}`;

function newRule(type: RuleType, missionId: string, groupIds: string[]): Rule {
  const pts = Object.fromEntries(groupIds.map((g) => [g, 5]));
  const base = { id: uid(type), missionId, label: RULE_TYPE_LABELS[type].split(" (")[0], description: "", enabled: true, sourceFilter: [] as string[] };
  switch (type) {
    case "sales_rate":
      return { ...base, type, rates: Object.fromEntries(groupIds.map((g) => [g, { per: 1000, points: 1 }])), aggregation: "team_total" };
    case "doctor_new":
      return { ...base, type, points: pts };
    case "doctor_reactivation":
      return { ...base, type, minMonthsGap: 6, points: pts };
    case "repeat_order":
      return { ...base, type, entity: "doctor", nth: 2, includeAfterNth: false, points: pts };
    case "per_order":
      return { ...base, type, points: pts };
    case "order_threshold":
      return { ...base, type, minAmount: 100000, basis: "focus_products", requireDoctor: true, points: 50 };
    case "manual_claim":
      return { ...base, type, points: pts };
  }
}

export function RulesEditor({ campaignId, initial, sources, zohoEnabled }: Props) {
  const [rs, setRs] = useState<Ruleset>(initial);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [rawMode, setRawMode] = useState(false);
  const [raw, setRaw] = useState("");

  const update = (fn: (draft: Ruleset) => void) => {
    setRs((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
    setDirty(true);
    setStatus(null);
  };

  const save = () =>
    start(async () => {
      const json = rawMode ? raw : JSON.stringify(rs);
      const r = await saveRuleset(campaignId, json);
      if (r.ok) {
        if (rawMode) setRs(JSON.parse(raw));
        setDirty(false);
        setStatus({ ok: true, text: "Saved — the leaderboard is re-scored with these rules." });
      } else setStatus({ ok: false, text: r.error });
    });

  const groupIds = rs.productGroups.map((g) => g.id);
  const groupName = (id: string) => rs.productGroups.find((g) => g.id === id)?.name ?? id;

  return (
    <div className="space-y-8 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted">
          Rules are recalculated from source data every time the leaderboard loads, so changes apply retroactively to the whole campaign.
        </p>
        <button
          className="btn btn-sm"
          onClick={() => {
            if (!rawMode) setRaw(JSON.stringify(rs, null, 2));
            else {
              try {
                setRs(JSON.parse(raw));
              } catch {
                setStatus({ ok: false, text: "Fix the JSON before switching back." });
                return;
              }
            }
            setRawMode(!rawMode);
          }}
        >
          {rawMode ? "Visual editor" : "Edit as JSON"}
        </button>
      </div>

      {rawMode ? (
        <textarea
          className="input min-h-[70vh] font-mono text-xs"
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            setDirty(true);
          }}
          spellCheck={false}
        />
      ) : (
        <>
          {/* Product groups */}
          <Section title="Product groups" hint="Rank 1 is the highest tier. An order counts in the highest-ranked group among its focus products.">
            <div className="grid gap-4 lg:grid-cols-2">
              {rs.productGroups.map((g, gi) => (
                <div key={gi} className="card p-4">
                  <div className="grid grid-cols-[1fr_90px_70px_auto] items-end gap-2">
                    <Field label="Group name">
                      <input className="input" value={g.name} onChange={(e) => update((d) => void (d.productGroups[gi].name = e.target.value))} />
                    </Field>
                    <Field label="ID">
                      <input className="input" value={g.id} onChange={(e) => update((d) => void (d.productGroups[gi].id = slug(e.target.value)))} />
                    </Field>
                    <Field label="Rank">
                      <input type="number" min={1} className="input" value={g.rank} onChange={(e) => update((d) => void (d.productGroups[gi].rank = Number(e.target.value) || 1))} />
                    </Field>
                    <button className="btn btn-sm btn-danger" onClick={() => update((d) => void d.productGroups.splice(gi, 1))} disabled={rs.productGroups.length === 1}>
                      ✕
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {g.products.map((p, pi) => (
                      <span key={pi} className="flex items-center gap-1 rounded-md bg-surface-2 px-2 py-1 text-xs" title={p.itemId ? `Zoho item ${p.itemId}` : "Item id resolved on next sync"}>
                        {p.name}
                        {!p.itemId && <span className="text-accent">*</span>}
                        <button className="ml-1 text-muted hover:text-bad" onClick={() => update((d) => void d.productGroups[gi].products.splice(pi, 1))} aria-label={`Remove ${p.name}`}>
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                  <ProductAdder
                    zohoEnabled={zohoEnabled}
                    onAdd={(name, itemId) => update((d) => void d.productGroups[gi].products.push(itemId ? { name, itemId } : { name }))}
                  />
                </div>
              ))}
            </div>
            <button
              className="btn btn-sm mt-3"
              onClick={() => update((d) => void d.productGroups.push({ id: uid("group"), name: "New group", rank: d.productGroups.length + 1, products: [] }))}
            >
              + Add group
            </button>
          </Section>

          {/* Missions */}
          <Section title="Missions" hint="Categories that rules roll up into. Shown as columns and colors on the leaderboard.">
            <div className="space-y-2">
              {rs.missions.map((m, mi) => (
                <div key={mi} className="card grid grid-cols-[56px_1fr_1fr_120px_auto] items-end gap-2 p-3">
                  <Field label="Color">
                    <input type="color" className="h-9 w-full cursor-pointer rounded-md border border-line bg-surface-2" value={m.color} onChange={(e) => update((d) => void (d.missions[mi].color = e.target.value))} />
                  </Field>
                  <Field label="Name">
                    <input className="input" value={m.name} onChange={(e) => update((d) => void (d.missions[mi].name = e.target.value))} />
                  </Field>
                  <Field label="Subtitle">
                    <input className="input" value={m.subtitle} onChange={(e) => update((d) => void (d.missions[mi].subtitle = e.target.value))} />
                  </Field>
                  <Field label="ID">
                    <input className="input" value={m.id} onChange={(e) => update((d) => void (d.missions[mi].id = slug(e.target.value)))} />
                  </Field>
                  <button className="btn btn-sm btn-danger" disabled={rs.missions.length === 1} onClick={() => update((d) => void d.missions.splice(mi, 1))}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button className="btn btn-sm mt-3" onClick={() => update((d) => void d.missions.push({ id: uid("mission"), name: "New mission", subtitle: "", color: "#a855f7" }))}>
              + Add mission
            </button>
          </Section>

          {/* Rules */}
          <Section title="Scoring rules" hint="Each rule awards points to the team whose Zoho salesperson is on the invoice.">
            <div className="space-y-3">
              {rs.rules.map((rule, ri) => (
                <RuleCard
                  key={rule.id + ri}
                  rule={rule}
                  rs={rs}
                  sources={sources}
                  groupName={groupName}
                  onChange={(fn) => update((d) => fn(d.rules[ri]))}
                  onRemove={() => update((d) => void d.rules.splice(ri, 1))}
                  onMove={(dir) =>
                    update((d) => {
                      const j = ri + dir;
                      if (j < 0 || j >= d.rules.length) return;
                      [d.rules[ri], d.rules[j]] = [d.rules[j], d.rules[ri]];
                    })
                  }
                />
              ))}
            </div>
            <AddRule onAdd={(t) => update((d) => void d.rules.push(newRule(t, d.missions[0].id, groupIds)))} />
          </Section>

          {/* Awards */}
          <Section title="Awards" hint="Who's leading each award is shown on the leaderboard. Winners are flagged if an MD partner would receive more than one reward.">
            <div className="space-y-2">
              {rs.awards.map((a, ai) => (
                <AwardRow key={ai} award={a} rs={rs} onChange={(fn) => update((d) => fn(d.awards[ai]))} onRemove={() => update((d) => void d.awards.splice(ai, 1))} />
              ))}
            </div>
            <button
              className="btn btn-sm mt-3"
              onClick={() =>
                update((d) =>
                  void d.awards.push({ id: uid("award"), title: "New award", subtitle: "", prize: "", basis: { kind: "overall_rank", place: d.awards.length + 1 }, excludeOverallWinners: false }),
                )
              }
            >
              + Add award
            </button>
          </Section>

          {/* Zoho mapping */}
          <Section title="Zoho field mapping" hint="Which invoice custom fields hold the doctor and order source.">
            <div className="card grid gap-3 p-4 sm:grid-cols-2">
              <Field label="Doctor field (API name)">
                <input className="input" value={rs.zoho.doctorField} onChange={(e) => update((d) => void (d.zoho.doctorField = e.target.value))} />
              </Field>
              <Field label="Source field (API name)">
                <input className="input" value={rs.zoho.sourceField} onChange={(e) => update((d) => void (d.zoho.sourceField = e.target.value))} />
              </Field>
              <Field label="Doctor values meaning 'no doctor' (comma separated)">
                <input
                  className="input"
                  value={rs.zoho.blankDoctorValues.join(", ")}
                  onChange={(e) => update((d) => void (d.zoho.blankDoctorValues = e.target.value.split(",").map((s) => s.trim().toLowerCase())))}
                />
              </Field>
              <Field label="Invoice statuses to ignore (comma separated)">
                <input
                  className="input"
                  value={rs.zoho.excludedStatuses.join(", ")}
                  onChange={(e) => update((d) => void (d.zoho.excludedStatuses = e.target.value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)))}
                />
              </Field>
            </div>
          </Section>
        </>
      )}

      {/* Save bar */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <p className={`min-w-0 flex-1 truncate whitespace-pre-line text-sm ${status ? (status.ok ? "text-good" : "text-bad") : "text-muted"}`} title={status?.text}>
            {status?.text ?? (dirty ? "Unsaved changes" : "All changes saved")}
          </p>
          <button className="btn btn-primary" disabled={!dirty || pending} onClick={save}>
            {pending ? "Saving…" : "Save rules"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-2xl font-bold uppercase">{title}</h2>
      {hint && <p className="mb-3 text-sm text-muted">{hint}</p>}
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

function ProductAdder({ onAdd, zohoEnabled }: { onAdd: (name: string, itemId?: string) => void; zohoEnabled: boolean }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ item_id: string; name: string; sku: string }[] | null>(null);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="mt-3">
      <div className="flex gap-2">
        <input
          className="input"
          placeholder="Exact Zoho item name, e.g. PazoGet 400mg"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && q.trim()) {
              onAdd(q.trim());
              setQ("");
            }
          }}
        />
        <button className="btn btn-sm" disabled={!q.trim()} onClick={() => (onAdd(q.trim()), setQ(""))}>
          Add
        </button>
        {zohoEnabled && (
          <button
            className="btn btn-sm"
            disabled={!q.trim() || pending}
            onClick={() =>
              start(async () => {
                setErr("");
                const r = await searchZohoItems(q.trim());
                if (r.ok) setResults(r.items);
                else setErr(r.error);
              })
            }
          >
            {pending ? "…" : "Search Zoho"}
          </button>
        )}
      </div>
      {err && <p className="mt-1 text-xs text-bad">{err}</p>}
      {results && (
        <ul className="mt-2 max-h-48 overflow-auto rounded-md border border-line text-xs">
          {results.map((it) => (
            <li key={it.item_id}>
              <button className="flex w-full justify-between px-2 py-1.5 text-left hover:bg-surface-2" onClick={() => (onAdd(it.name, it.item_id), setResults(null), setQ(""))}>
                <span>{it.name}</span>
                <span className="text-muted">{it.sku}</span>
              </button>
            </li>
          ))}
          {!results.length && <li className="px-2 py-1.5 text-muted">No items found</li>}
        </ul>
      )}
    </div>
  );
}

function AddRule({ onAdd }: { onAdd: (t: RuleType) => void }) {
  const [t, setT] = useState<RuleType>("sales_rate");
  return (
    <div className="mt-3 flex gap-2">
      <select className="input w-auto" value={t} onChange={(e) => setT(e.target.value as RuleType)}>
        {Object.entries(RULE_TYPE_LABELS).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </select>
      <button className="btn btn-sm" onClick={() => onAdd(t)}>+ Add rule</button>
    </div>
  );
}

function GroupPoints({ points, rs, onChange }: { points: Record<string, number>; rs: Ruleset; onChange: (gid: string, v: number) => void }) {
  return (
    <>
      {rs.productGroups.map((g) => (
        <Field key={g.id} label={`Pts · ${g.name}`}>
          <input type="number" className="input" value={points[g.id] ?? 0} onChange={(e) => onChange(g.id, Number(e.target.value))} />
        </Field>
      ))}
    </>
  );
}

function RuleCard({
  rule, rs, sources, groupName, onChange, onRemove, onMove,
}: {
  rule: Rule;
  rs: Ruleset;
  sources: string[];
  groupName: (id: string) => string;
  onChange: (fn: (r: Rule) => void) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const mission = rs.missions.find((m) => m.id === rule.missionId);
  return (
    <div className={`card p-4 ${rule.enabled ? "" : "opacity-60"}`} style={{ borderLeft: `4px solid ${mission?.color ?? "var(--line)"}` }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-surface-2 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{RULE_TYPE_LABELS[rule.type]}</span>
        <span className="text-[11px] text-muted">id: {rule.id}</span>
        <div className="ml-auto flex items-center gap-1">
          <label className="mr-2 flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={rule.enabled} onChange={(e) => onChange((r) => void (r.enabled = e.target.checked))} /> Enabled
          </label>
          <button className="btn btn-sm" onClick={() => onMove(-1)} aria-label="Move up">↑</button>
          <button className="btn btn-sm" onClick={() => onMove(1)} aria-label="Move down">↓</button>
          <button className="btn btn-sm btn-danger" onClick={() => confirm(`Delete rule "${rule.label}"?`) && onRemove()}>Delete</button>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_200px]">
        <Field label="Label (shown on leaderboard)">
          <input className="input" value={rule.label} onChange={(e) => onChange((r) => void (r.label = e.target.value))} />
        </Field>
        <Field label="Mission">
          <select className="input" value={rule.missionId} onChange={(e) => onChange((r) => void (r.missionId = e.target.value))}>
            {rs.missions.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="mt-3">
        <Field label="Description">
          <input className="input" value={rule.description} onChange={(e) => onChange((r) => void (r.description = e.target.value))} />
        </Field>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {rule.type === "sales_rate" && (
          <>
            {rs.productGroups.map((g) => {
              const rate = rule.rates[g.id] ?? { per: 1000, points: 0 };
              return (
                <div key={g.id} className="col-span-2 grid grid-cols-2 gap-2">
                  <Field label={`${g.name} · points`}>
                    <input type="number" className="input" value={rate.points} onChange={(e) => onChange((r) => r.type === "sales_rate" && void (r.rates[g.id] = { ...rate, points: Number(e.target.value) }))} />
                  </Field>
                  <Field label={`per ₱ of sales`}>
                    <input type="number" className="input" value={rate.per} onChange={(e) => onChange((r) => r.type === "sales_rate" && void (r.rates[g.id] = { ...rate, per: Math.max(1, Number(e.target.value)) }))} />
                  </Field>
                </div>
              );
            })}
            <Field label="Rounding">
              <select className="input" value={rule.aggregation} onChange={(e) => onChange((r) => r.type === "sales_rate" && void (r.aggregation = e.target.value as "team_total"))}>
                <option value="team_total">Round down on team total</option>
                <option value="per_invoice">Round down per invoice</option>
              </select>
            </Field>
          </>
        )}

        {rule.type === "doctor_reactivation" && (
          <Field label="Inactive for at least (months)">
            <input type="number" min={1} className="input" value={rule.minMonthsGap} onChange={(e) => onChange((r) => r.type === "doctor_reactivation" && void (r.minMonthsGap = Number(e.target.value) || 1))} />
          </Field>
        )}

        {rule.type === "repeat_order" && (
          <>
            <Field label="Same">
              <select className="input" value={rule.entity} onChange={(e) => onChange((r) => r.type === "repeat_order" && void (r.entity = e.target.value as "doctor"))}>
                <option value="doctor">Doctor</option>
                <option value="customer">Customer / hospital</option>
              </select>
            </Field>
            <Field label="Order number in month">
              <input type="number" min={2} className="input" value={rule.nth} onChange={(e) => onChange((r) => r.type === "repeat_order" && void (r.nth = Math.max(2, Number(e.target.value))))} />
            </Field>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" checked={rule.includeAfterNth} onChange={(e) => onChange((r) => r.type === "repeat_order" && void (r.includeAfterNth = e.target.checked))} />
              Also score every later order
            </label>
          </>
        )}

        {rule.type === "per_order" && (
          <Field label="Only new customers: no invoice in last N months (blank = any)">
            <input
              type="number"
              min={1}
              className="input"
              value={rule.newCustomerMonths ?? ""}
              placeholder="e.g. 6"
              onChange={(e) => onChange((r) => r.type === "per_order" && void (r.newCustomerMonths = e.target.value ? Math.max(1, Number(e.target.value)) : undefined))}
            />
          </Field>
        )}

        {rule.type === "order_threshold" && (
          <>
            <Field label="Minimum single order (₱)">
              <input type="number" className="input" value={rule.minAmount} onChange={(e) => onChange((r) => r.type === "order_threshold" && void (r.minAmount = Number(e.target.value)))} />
            </Field>
            <Field label="Counted value">
              <select className="input" value={rule.basis} onChange={(e) => onChange((r) => r.type === "order_threshold" && void (r.basis = e.target.value as "focus_products"))}>
                <option value="focus_products">Focus products only</option>
                <option value="invoice_total">Whole invoice total</option>
              </select>
            </Field>
            <Field label="Bonus points">
              <input type="number" className="input" value={rule.points} onChange={(e) => onChange((r) => r.type === "order_threshold" && void (r.points = Number(e.target.value)))} />
            </Field>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" checked={rule.requireDoctor} onChange={(e) => onChange((r) => r.type === "order_threshold" && void (r.requireDoctor = e.target.checked))} />
              Must have a doctor
            </label>
          </>
        )}

        {"points" in rule && typeof rule.points === "object" && (
          <GroupPoints points={rule.points} rs={rs} onChange={(gid, v) => onChange((r) => void ((r as { points: Record<string, number> }).points[gid] = v))} />
        )}
      </div>

      {rule.type !== "manual_claim" && (
        <div className="mt-3">
          <span className="label">Only invoices with Source</span>
          <div className="flex flex-wrap gap-1.5">
            {sources.map((s) => {
              const on = rule.sourceFilter.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-text"}`}
                  onClick={() => onChange((r) => void (r.sourceFilter = on ? r.sourceFilter.filter((x) => x !== s) : [...r.sourceFilter, s]))}
                >
                  {s}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-[11px] text-muted">{rule.sourceFilter.length ? `Only: ${rule.sourceFilter.join(", ")}` : "Any source"}</p>
        </div>
      )}
      {rule.type === "manual_claim" && (
        <p className="mt-3 text-xs text-muted">Points are awarded when an admin approves a claim on the Claims tab. Claim group decides the {Object.keys(rule.points).map(groupName).join(" / ")} rate.</p>
      )}
    </div>
  );
}

function AwardRow({ award, rs, onChange, onRemove }: { award: Award; rs: Ruleset; onChange: (fn: (a: Award) => void) => void; onRemove: () => void }) {
  const b = award.basis;
  return (
    <div className="card grid items-end gap-2 p-3 sm:grid-cols-[1fr_1fr_110px_1.3fr_1fr_auto]">
      <Field label="Title">
        <input className="input" value={award.title} onChange={(e) => onChange((a) => void (a.title = e.target.value))} />
      </Field>
      <Field label="Subtitle">
        <input className="input" value={award.subtitle} onChange={(e) => onChange((a) => void (a.subtitle = e.target.value))} />
      </Field>
      <Field label="Prize">
        <input className="input" value={award.prize} onChange={(e) => onChange((a) => void (a.prize = e.target.value))} />
      </Field>
      <Field label="Decided by">
        <select
          className="input"
          value={b.kind}
          onChange={(e) =>
            onChange((a) => {
              const k = e.target.value;
              a.basis =
                k === "overall_rank" ? { kind: k, place: 1 }
                : k === "mission_points" ? { kind: k, missionId: rs.missions[0].id }
                : k === "rule_points" ? { kind: k, ruleId: rs.rules[0]?.id ?? "" }
                : { kind: "max_single_order" };
            })
          }
        >
          <option value="overall_rank">Overall rank</option>
          <option value="mission_points">Most points in mission</option>
          <option value="rule_points">Most points from rule</option>
          <option value="max_single_order">Biggest single doctor order</option>
        </select>
      </Field>
      <div>
        {b.kind === "overall_rank" && (
          <Field label="Place">
            <input type="number" min={1} className="input" value={b.place} onChange={(e) => onChange((a) => a.basis.kind === "overall_rank" && void (a.basis.place = Number(e.target.value) || 1))} />
          </Field>
        )}
        {b.kind === "mission_points" && (
          <Field label="Mission">
            <select className="input" value={b.missionId} onChange={(e) => onChange((a) => a.basis.kind === "mission_points" && void (a.basis.missionId = e.target.value))}>
              {rs.missions.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </Field>
        )}
        {b.kind === "rule_points" && (
          <Field label="Rule">
            <select className="input" value={b.ruleId} onChange={(e) => onChange((a) => a.basis.kind === "rule_points" && void (a.basis.ruleId = e.target.value))}>
              {rs.rules.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </Field>
        )}
        {b.kind !== "overall_rank" && (
          <label className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
            <input type="checkbox" checked={award.excludeOverallWinners} onChange={(e) => onChange((a) => void (a.excludeOverallWinners = e.target.checked))} />
            Exclude top placers
          </label>
        )}
      </div>
      <button className="btn btn-sm btn-danger" onClick={onRemove}>✕</button>
    </div>
  );
}
