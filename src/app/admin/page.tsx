import Link from "next/link";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { fmtRange, timeAgo } from "@/lib/format";
import { createCampaign } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_STYLE = { draft: "bg-surface-2 text-muted", live: "bg-accent-soft text-accent", closed: "bg-surface-2 text-text" };

export default async function AdminHome() {
  const campaigns = await db.select().from(schema.campaigns).orderBy(desc(schema.campaigns.startDate));

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <section>
        <h1 className="font-display text-3xl font-extrabold uppercase">Campaigns</h1>
        <div className="mt-4 space-y-3">
          {campaigns.map((c) => (
            <Link key={c.id} href={`/admin/c/${c.id}`} className="card flex flex-wrap items-center gap-4 p-4 hover:border-accent">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold uppercase ${STATUS_STYLE[c.status]}`}>{c.status}</span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{c.name}</div>
                <div className="text-xs text-muted">
                  /c/{c.slug} · {fmtRange(c.startDate, c.endDate)} · {c.dataSource === "demo" ? "Demo data" : "Zoho Books"}
                </div>
              </div>
              <span className="text-xs text-muted">Synced {timeAgo(c.lastSyncedAt)}</span>
            </Link>
          ))}
        </div>
      </section>

      <aside className="card h-fit p-5">
        <h2 className="font-display text-xl font-bold uppercase">New campaign</h2>
        <form action={createCampaign} className="mt-4 space-y-3">
          <div>
            <label className="label">Name</label>
            <input name="name" className="input" required placeholder="RISE Challenge 4.0" />
          </div>
          <div>
            <label className="label">URL slug</label>
            <input name="slug" className="input" required placeholder="rise-4" />
          </div>
          <div>
            <label className="label">Tagline</label>
            <input name="tagline" className="input" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Start</label>
              <input name="startDate" type="date" className="input" required />
            </div>
            <div>
              <label className="label">End</label>
              <input name="endDate" type="date" className="input" required />
            </div>
          </div>
          <div>
            <label className="label">Start rules from</label>
            <select name="template" className="input">
              <option value="rise3">RISE 3.0 template</option>
              <option value="blank">Blank ruleset</option>
              {campaigns.map((c) => (
                <option key={c.id} value={`copy:${c.id}`}>
                  Copy of {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Data source</label>
            <select name="dataSource" className="input">
              <option value="zoho">Zoho Books (live)</option>
              <option value="demo">Demo data</option>
            </select>
          </div>
          <button className="btn btn-primary w-full justify-center">Create as draft</button>
        </form>
      </aside>
    </div>
  );
}
