"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  ["", "Overview"],
  ["/rules", "Rules"],
  ["/teams", "Teams"],
  ["/claims", "Claims"],
  ["/adjustments", "Adjustments"],
  ["/settings", "Settings"],
] as const;

export function Tabs({ base }: { base: string }) {
  const path = usePathname();
  return (
    <nav className="mt-6 flex gap-1 overflow-x-auto border-b border-line">
      {TABS.map(([href, label]) => {
        const active = path === base + href;
        return (
          <Link
            key={href}
            href={base + href}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold whitespace-nowrap ${active ? "border-accent text-text" : "border-transparent text-muted hover:text-text"}`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
