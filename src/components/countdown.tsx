"use client";

import { useSyncExternalStore } from "react";

const TICK_MS = 15_000;
const subscribe = (cb: () => void) => {
  const id = setInterval(cb, TICK_MS);
  return () => clearInterval(id);
};
// Snapshot is stable within a tick so React doesn't re-render needlessly.
const getSnapshot = () => Math.floor(Date.now() / TICK_MS) * TICK_MS;
const getServerSnapshot = () => null;

/** Days : hours : minutes until the end of `endDate` in Manila time. */
export function Countdown({ endDate }: { endDate: string }) {
  const end = Date.parse(`${endDate}T23:59:59+08:00`);
  const now = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const ms = Math.max(0, end - (now ?? end));
  const parts = [
    [Math.floor(ms / 86_400_000), "Days"],
    [Math.floor(ms / 3_600_000) % 24, "Hrs"],
    [Math.floor(ms / 60_000) % 60, "Mins"],
  ] as const;

  return (
    <div className="flex items-start gap-2 sm:gap-3">
      {parts.map(([v, label], i) => (
        <div key={label} className="flex items-start gap-2 sm:gap-3">
          {i > 0 && <span className="pt-0.5 text-3xl font-bold text-muted sm:text-4xl">:</span>}
          <div className="text-center">
            <div className="tnum text-3xl font-bold sm:text-4xl">{now === null ? "--" : String(v).padStart(2, "0")}</div>
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
