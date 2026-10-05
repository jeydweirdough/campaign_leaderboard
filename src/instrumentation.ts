/**
 * Background Zoho sync while the server is running, so a page reload always
 * shows recent data. It calls the app's own cron endpoint, which keeps all
 * Zoho/database code out of server start-up.
 *
 * AUTO_SYNC_MINUTES=15 (default) · set to 0 to disable (e.g. on Vercel, where Vercel Cron does this).
 */
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const minutes = Number(process.env.AUTO_SYNC_MINUTES ?? 15);
  const secret = process.env.CRON_SECRET;
  if (!minutes || minutes < 1 || !secret) return;

  // Guard against duplicate timers when the dev server hot-reloads.
  const g = globalThis as unknown as { __autoSync?: NodeJS.Timeout };
  if (g.__autoSync) clearInterval(g.__autoSync);

  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const port = process.env.PORT ?? "3000";
      const res = await fetch(`http://127.0.0.1:${port}/api/cron/sync`, { headers: { authorization: `Bearer ${secret}` } });
      const body = await res.json().catch(() => ({}));
      console.log(`[auto-sync] ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
    } catch (e) {
      console.warn(`[auto-sync] failed: ${(e as Error).message}`);
    } finally {
      running = false;
    }
  };

  setTimeout(run, 60_000); // first sync a minute after start
  g.__autoSync = setInterval(run, minutes * 60_000);
}
