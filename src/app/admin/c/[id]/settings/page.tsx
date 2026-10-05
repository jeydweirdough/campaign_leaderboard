import { notFound } from "next/navigation";
import { getCampaign } from "@/lib/score";
import { ConfirmButton } from "@/components/confirm-button";
import { deleteCampaign, updateCampaign } from "../../../actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ params }: PageProps<"/admin/c/[id]/settings">) {
  const { id } = await params;
  const c = await getCampaign(id);
  if (!c) notFound();

  return (
    <div className="max-w-2xl space-y-8">
      <form action={updateCampaign.bind(null, id)} className="card space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Name</span>
            <input name="name" className="input" defaultValue={c.name} required />
          </label>
          <label className="block">
            <span className="label">URL slug</span>
            <input name="slug" className="input" defaultValue={c.slug} required />
          </label>
        </div>
        <label className="block">
          <span className="label">Tagline</span>
          <input name="tagline" className="input" defaultValue={c.tagline} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Start date</span>
            <input name="startDate" type="date" className="input" defaultValue={c.startDate} required />
          </label>
          <label className="block">
            <span className="label">End date</span>
            <input name="endDate" type="date" className="input" defaultValue={c.endDate} required />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Visibility</span>
            <select name="status" className="input" defaultValue={c.status}>
              <option value="draft">Draft — admins only</option>
              <option value="live">Live — public leaderboard</option>
              <option value="closed">Closed — public, final</option>
            </select>
          </label>
          <label className="block">
            <span className="label">Data source</span>
            <select name="dataSource" className="input" defaultValue={c.dataSource}>
              <option value="zoho">Zoho Books (live)</option>
              <option value="demo">Demo data</option>
            </select>
          </label>
        </div>
        <button className="btn btn-primary">Save settings</button>
      </form>

      <form action={deleteCampaign.bind(null, id)} className="card border-bad/40 p-5">
        <h2 className="font-display text-xl font-bold uppercase text-bad">Delete campaign</h2>
        <p className="mt-1 text-sm text-muted">Removes the campaign with its teams, claims and adjustments. Cached Zoho invoices are kept.</p>
        <ConfirmButton message={`Delete "${c.name}" permanently?`} className="btn btn-danger mt-3">
          Delete permanently
        </ConfirmButton>
      </form>
    </div>
  );
}
