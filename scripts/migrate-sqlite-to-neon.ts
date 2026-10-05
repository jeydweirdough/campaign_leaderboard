/**
 * One-time copy of the old local SQLite database (data/leaderboard.db) into Neon.
 * Safe to re-run: existing rows are skipped (ON CONFLICT DO NOTHING).
 *   npx tsx --env-file=.env.local scripts/migrate-sqlite-to-neon.ts
 */
import { createClient } from "@libsql/client";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../src/lib/db/schema";

const sqlite = createClient({ url: "file:./data/leaderboard.db" });
const db = drizzle(neon(process.env.DATABASE_URL!), { schema });

const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const JSON_COLS = new Set(["ruleset", "salespersonIds", "lines"]);

async function rows(table: string) {
  const res = await sqlite.execute(`select * from ${table}`);
  return res.rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      const key = camel(k);
      out[key] = JSON_COLS.has(key) && typeof v === "string" ? JSON.parse(v) : key === "ok" ? Boolean(v) : v;
    }
    return out;
  });
}

// Parents before children (foreign keys).
const TABLES = [
  ["campaigns", schema.campaigns],
  ["teams", schema.teams],
  ["invoices", schema.invoices],
  ["doctor_history", schema.doctorHistory],
  ["customer_history", schema.customerHistory],
  ["claims", schema.claims],
  ["adjustments", schema.adjustments],
  ["exclusions", schema.exclusions],
  ["sync_logs", schema.syncLogs],
] as const;

async function main() {
  for (const [name, table] of TABLES) {
    let data: Record<string, unknown>[];
    try {
      data = await rows(name);
    } catch {
      console.log(`${name.padEnd(17)} (not in SQLite — skipped)`);
      continue;
    }
    if (name === "sync_logs") data = data.map(({ id: _id, ...rest }) => rest); // let Postgres assign ids
    for (let i = 0; i < data.length; i += 100) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await db.insert(table).values(data.slice(i, i + 100) as any).onConflictDoNothing();
    }
    console.log(`${name.padEnd(17)} ${data.length} rows`);
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
