"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders server data periodically so a wall-mounted leaderboard stays current. */
export function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
