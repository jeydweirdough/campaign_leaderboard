"use client";

import { useState, useTransition } from "react";
import { runSync } from "../../actions";

export function SyncButton({ campaignId }: { campaignId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <div>
      <button
        className="btn btn-primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg(null);
            const r = await runSync(campaignId);
            if (!r.ok) setMsg({ ok: false, text: r.error });
            else {
              const s = r.summary;
              setMsg({
                ok: s.errors.length === 0,
                text:
                  `${s.dryRun ? "[DRY RUN] " : ""}${s.listed} focus invoices · ${s.fetched} fetched · ${s.unchanged} unchanged · ${s.removed} removed · ${s.doctorsChecked} doctors checked` +
                  (s.unresolvedItems.length ? `\nUnresolved products: ${s.unresolvedItems.join(", ")}` : "") +
                  (s.errors.length ? `\n${s.errors.length} error(s): ${s.errors.slice(0, 3).join("; ")}` : ""),
              });
            }
          })
        }
      >
        {pending ? "Syncing… (can take a few minutes)" : "Sync from Zoho now"}
      </button>
      {msg && <p className={`mt-2 whitespace-pre-line text-xs ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</p>}
    </div>
  );
}
