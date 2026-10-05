/**
 * Sync live Zoho campaigns from the command line (no dev server needed).
 *   npm run sync            -> every live Zoho campaign
 *   npm run sync -- rise-3  -> one campaign by slug
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import { syncCampaign } from "../src/lib/sync";

async function main() {
  const slug = process.argv[2];
  const campaigns = await db
    .select()
    .from(schema.campaigns)
    .where(slug ? eq(schema.campaigns.slug, slug) : and(eq(schema.campaigns.status, "live"), eq(schema.campaigns.dataSource, "zoho")));
  if (!campaigns.length) throw new Error(slug ? `No campaign "${slug}"` : "No live Zoho campaigns");

  for (const c of campaigns) {
    console.log(`Syncing ${c.name} (${c.startDate} → ${c.endDate})…`);
    const started = Date.now();
    const s = await syncCampaign(c.id);
    console.log(
      `  ${s.dryRun ? "[DRY RUN] " : ""}${s.listed} focus invoices · ${s.fetched} fetched · ${s.unchanged} unchanged · ${s.removed} removed · ${s.doctorsChecked} doctors checked · ${Math.round((Date.now() - started) / 1000)}s`,
    );
    if (s.unresolvedItems.length) console.log(`  Unresolved products: ${s.unresolvedItems.join(", ")}`);
    for (const e of s.errors) console.log(`  ERROR ${e}`);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
