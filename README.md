# Campaign Leaderboard

A leaderboard for GetMEDS / 2MG sales campaigns. Anyone can view the public standings. Admins configure each campaign's rulesets, map teams to Zoho salespersons, validate claims and correct scores.

**Stack:** Next.js 16 (App Router), React 19, Tailwind v4, Drizzle ORM on SQLite/libSQL, Zod, and the Zoho Books API (read-only).

## Quick start

```bash
npm install
npm run db:push     # create tables in ./data/leaderboard.db
npm run db:seed     # RISE 3.0 (live, Zoho) + Demo League (draft, sample data)
npm run dev
```

- Public site: http://localhost:3000 (the leaderboard is at `/c/rise-3`).
- Admin: http://localhost:3000/admin. The password is `ADMIN_PASSWORD` in `.env.local`.
- The Demo League stays a draft. Admins can preview it at `/c/demo-league`.

## Zoho setup

Zoho settings live in `.env.local`. `ZOHO_ORG_ID` must also appear in `ZOHO_ALLOWED_ORG_IDS`. Syncing needs a Zoho **Self Client** from https://api-console.zoho.com with these scopes:

```
ZohoBooks.invoices.READ,ZohoBooks.settings.READ
```

Generate a refresh token, then set `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET` and `ZOHO_REFRESH_TOKEN`. If you're outside the US data centre, also change `ZOHO_ACCOUNTS_URL` and `ZOHO_API_BASE`.

- `ZOHO_DRY_RUN=true` fetches data and reports what it found, but writes nothing.
- The app never writes to Zoho.

### What a sync does

1. Lists the invoices in the campaign period that contain any focus product. It filters by `item_id`, so other invoices are never downloaded.
2. Fetches line items only for invoices that are new or changed, based on `last_modified_time`.
3. Finds each doctor's most recent invoice **before** their first focus order in the campaign. It searches the `cf_doctor_name` custom field. The New Doctor and Reactivation rules depend on this result.

Ways to run a sync:

- **Automatic:** while the server runs, it syncs every live Zoho campaign every `AUTO_SYNC_MINUTES` (default 15, `0` turns it off). A page reload shows whatever the last sync saved, and the leaderboard auto-refreshes every 60s.
- **Command line:** `npm run sync`, or `npm run sync -- rise-3` for one campaign. This doesn't need the dev server, so prefer it on low-memory machines.
- Click **Sync from Zoho now** on a campaign's admin Overview tab.
- Schedule `GET /api/cron/sync` with the header `Authorization: Bearer $CRON_SECRET`. Use this on Vercel and set `AUTO_SYNC_MINUTES=0` there.

## How scoring works

Scores are **never stored**. Each page load runs [`computeScores`](src/lib/rules/engine.ts) over:

- the cached invoices
- approved claims
- adjustments
- exclusions

Editing a rule therefore re-scores the whole campaign immediately.

### Core concepts

| Concept | Meaning |
|---|---|
| Product group | A tier of focus products, ranked. An order belongs to the highest-ranked group among its focus lines. |
| Mission | A bucket that rules roll up into, shown as a column and colour on the leaderboard. |
| Team | RX CHC + MD Telesales partner, linked to one or more Zoho `salesperson_id`s. |
| Doctor | The invoice's `cf_doctor_name` field. Values such as `NA` mean no doctor. |
| Source | The invoice's `cf_source` field, e.g. `Hospital PO` or `Emergency purchase`. |

### Rule types

You can filter every rule by Source.

| Type | Use |
|---|---|
| `sales_rate` | X points per ₱Y of focus sales, set per group. |
| `doctor_new` | The doctor has no prior Zoho invoice. |
| `doctor_reactivation` | The doctor's last invoice was at least N months ago. |
| `repeat_order` | The Nth order from the same doctor or customer in a calendar month. |
| `per_order` | Flat points per qualifying invoice. Hospital POs use this with a Source filter. |
| `order_threshold` | A bonus for a single order at or above ₱X. This is the Buzzer Beater. |
| `manual_claim` | Admin-approved achievements, such as hospital inclusion letters. |

Awards can be decided by overall rank, mission points, rule points or the biggest single doctor order. If one MD partner would win more than one award, it is flagged. Under the SOP they can receive only ONE reward.

The RISE 3.0 SOP is encoded in [`presets.ts`](src/lib/rules/presets.ts). Its "Quick Examples" table is covered by tests:

```bash
npm test
```

## Deploying

The app runs anywhere Next.js runs. For Vercel:

- Use a hosted libSQL database (Turso): set `DATABASE_URL=libsql://…` and `DATABASE_AUTH_TOKEN`, then run `npm run db:push`.
- Add a Vercel Cron job that calls `/api/cron/sync`.
- Set a strong `ADMIN_PASSWORD` and a random `SESSION_SECRET`.
