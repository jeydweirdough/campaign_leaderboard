import Link from "next/link";
import { BookOpen, LayoutGrid, Settings, Trophy, Zap } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";

type NavKey = "campaigns" | "leaderboard" | "rules";

/** Icon sidebar + top bar used by every public page. */
export function PublicShell({
  children,
  active,
  slug,
  topRight,
}: {
  children: React.ReactNode;
  active: NavKey;
  slug?: string;
  topRight?: React.ReactNode;
}) {
  const items: { key: NavKey; href: string; label: string; icon: typeof Trophy }[] = [
    { key: "campaigns", href: "/", label: "All campaigns", icon: LayoutGrid },
    ...(slug
      ? [
          { key: "leaderboard" as const, href: `/c/${slug}`, label: "Leaderboard", icon: Trophy },
          { key: "rules" as const, href: `/c/${slug}#how-to-score`, label: "How to score", icon: BookOpen },
        ]
      : []),
  ];

  return (
    <div className="flex min-h-screen flex-1">
      <aside className="sticky top-0 hidden h-screen w-[72px] shrink-0 flex-col items-center bg-sidebar py-6 sm:flex">
        <Link href="/" aria-label="Home" className="text-accent">
          <Zap className="h-8 w-8" strokeWidth={2.5} />
        </Link>
        <nav className="mt-10 flex flex-1 flex-col gap-2">
          {items.map(({ key, href, label, icon: Icon }) => (
            <Link
              key={key}
              href={href}
              title={label}
              aria-label={label}
              className={`relative flex h-11 w-11 items-center justify-center rounded-xl transition ${
                active === key ? "text-accent" : "text-muted hover:bg-surface hover:text-text"
              }`}
            >
              <Icon className="h-[22px] w-[22px]" />
              {active === key && <span className="absolute -right-[14px] h-7 w-[3px] rounded-full bg-accent" />}
            </Link>
          ))}
        </nav>
        <Link href="/admin" title="Admin" aria-label="Admin" className="flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:bg-surface hover:text-text">
          <Settings className="h-[22px] w-[22px]" />
        </Link>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 px-4 pt-4 sm:px-8 sm:pt-5">
          {/* Sidebar is hidden on phones: show the same nav as compact icons */}
          <nav className="flex items-center gap-1 sm:invisible">
            <Link href="/" aria-label="Home" className="mr-1 text-accent">
              <Zap className="h-6 w-6" strokeWidth={2.5} />
            </Link>
            {items.map(({ key, href, label, icon: Icon }) => (
              <Link
                key={key}
                href={href}
                aria-label={label}
                className={`flex h-9 w-9 items-center justify-center rounded-full ${active === key ? "bg-accent-soft text-accent" : "text-muted"}`}
              >
                <Icon className="h-[18px] w-[18px]" />
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2 sm:gap-3">
            {topRight}
            <ThemeToggle />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-3 pb-16 pt-4 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
