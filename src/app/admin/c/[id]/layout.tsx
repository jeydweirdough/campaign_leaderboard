import Link from "next/link";
import { notFound } from "next/navigation";
import { getCampaign } from "@/lib/score";
import { fmtRange } from "@/lib/format";
import { Tabs } from "./tabs";

export default async function CampaignAdminLayout({ children, params }: LayoutProps<"/admin/c/[id]">) {
  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) notFound();
  return (
    <div>
      <Link href="/admin" className="text-xs font-semibold uppercase tracking-widest text-muted hover:text-text">
        ← Campaigns
      </Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl font-extrabold uppercase leading-none">{campaign.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {fmtRange(campaign.startDate, campaign.endDate)} · <span className="uppercase">{campaign.status}</span> ·{" "}
            {campaign.dataSource === "demo" ? "Demo data" : "Zoho Books"}
          </p>
        </div>
        <Link href={`/c/${campaign.slug}`} className="btn btn-sm" target="_blank">
          View leaderboard ↗
        </Link>
      </div>
      <Tabs base={`/admin/c/${id}`} />
      <div className="mt-6">{children}</div>
    </div>
  );
}
