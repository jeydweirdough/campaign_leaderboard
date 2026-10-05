import { notFound } from "next/navigation";
import { getCampaign } from "@/lib/score";
import { parseRuleset } from "@/lib/rules/schema";
import { RulesEditor } from "./rules-editor";

export const dynamic = "force-dynamic";

/** cf_source dropdown values in Zoho Books (org 714292728). */
const ZOHO_SOURCES = [
  "Doctor order",
  "Patient order referred by doctor",
  "Patient order referred by patient",
  "Emergency purchase",
  "Hospital PO",
  "Distributor order",
  "Bidding Order",
  "B2C Order",
  "PCSO",
  "IAPF",
  "DSWD",
  "Office of the President",
];

export default async function RulesPage({ params }: PageProps<"/admin/c/[id]/rules">) {
  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) notFound();
  return <RulesEditor campaignId={id} initial={parseRuleset(campaign.ruleset)} sources={ZOHO_SOURCES} zohoEnabled={campaign.dataSource === "zoho"} />;
}
