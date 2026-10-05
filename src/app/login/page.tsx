import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, checkPassword, createSessionValue } from "@/lib/auth";

async function login(formData: FormData) {
  "use server";
  const next = String(formData.get("next") || "/admin");
  if (!checkPassword(String(formData.get("password") ?? ""))) {
    redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  }
  (await cookies()).set(SESSION_COOKIE, await createSessionValue(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  redirect(next.startsWith("/") ? next : "/admin");
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  return (
    <main className="arena flex flex-1 items-center justify-center px-4">
      <form action={login} className="card w-full max-w-sm p-6">
        <h1 className="font-display text-3xl font-extrabold uppercase">Admin sign-in</h1>
        <p className="mt-1 text-sm text-muted">Manage campaigns, rules, teams and validation.</p>
        <input type="hidden" name="next" value={String(sp.next ?? "/admin")} />
        <label className="label mt-6" htmlFor="password">Password</label>
        <input id="password" name="password" type="password" className="input" autoFocus required />
        {sp.error && <p className="mt-2 text-sm text-bad">Incorrect password.</p>}
        <button className="btn btn-primary mt-5 w-full justify-center">Sign in</button>
      </form>
    </main>
  );
}
