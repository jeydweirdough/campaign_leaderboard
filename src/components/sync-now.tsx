"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { syncFromLeaderboard } from "@/app/c/[slug]/actions";

const MESSAGES = {
  synced: "Updated with the latest Zoho data.",
  fresh: "Already up to date.",
  busy: "Someone else is syncing. Showing the latest data.",
};

/** Hook behind every "Sync now" button: pulls from Zoho, then reloads the page data. */
export function useSyncNow(slug: string, onDone?: () => void) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const sync = () =>
    start(async () => {
      setMsg(null);
      // A rejected server action (e.g. the network dropped) would otherwise replace the page with the error screen.
      const res = await syncFromLeaderboard(slug).catch(() => ({ ok: false as const, error: "Couldn't sync. Check your connection and try again." }));
      setMsg(res.ok ? { ok: true, text: MESSAGES[res.status] } : { ok: false, text: res.error });
      router.refresh();
      onDone?.();
      setTimeout(() => setMsg(null), 6000);
    });

  return { sync, pending, msg };
}

/** Header control on the leaderboard: "Updated 3 hr ago · Sync now". */
export function SyncNow({ slug, updated }: { slug: string; updated: string }) {
  const { sync, pending, msg } = useSyncNow(slug);
  return (
    <div className="relative flex items-center gap-2">
      <span className="hidden text-xs text-muted sm:inline">Updated {updated}</span>
      <button
        onClick={sync}
        disabled={pending}
        title="Get the latest sales from Zoho"
        className="flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-xs font-semibold text-text transition hover:border-accent disabled:opacity-70"
      >
        <RefreshCw className={`h-4 w-4 text-accent ${pending ? "animate-spin" : ""}`} />
        <span>{pending ? "Syncing…" : "Sync now"}</span>
      </button>
      {msg && (
        <span role="status" className={`absolute right-0 top-full z-20 mt-2 w-max max-w-[16rem] rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg ${msg.ok ? "text-text" : "text-bad"}`}>
          {msg.text}
        </span>
      )}
    </div>
  );
}
