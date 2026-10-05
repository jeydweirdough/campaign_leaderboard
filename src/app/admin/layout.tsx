import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/lib/auth";
import { ThemeToggle } from "@/components/theme-toggle";

async function logout() {
  "use server";
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/");
}

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/admin" className="font-display text-xl font-extrabold uppercase">
            <span className="text-accent">●</span> Leaderboard Admin
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            <ThemeToggle />
            <Link href="/" className="btn btn-sm">Public site</Link>
            <form action={logout}>
              <button className="btn btn-sm">Sign out</button>
            </form>
          </nav>
        </div>
      </header>
      <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">{children}</div>
    </div>
  );
}
