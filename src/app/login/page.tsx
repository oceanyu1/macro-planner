import { signIn } from "@/auth";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-2xl font-semibold">Macro Planner</h1>
        <p className="mt-1 text-sm text-muted">Private app. Sign in to continue.</p>
      </div>
      {error && (
        <p className="rounded-xl border border-bad/40 bg-bad/10 p-3 text-sm text-bad">
          {error === "AccessDenied" ? "That account isn't on the allowlist." : "Sign-in failed. Try again."}
        </p>
      )}
      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/" });
        }}
      >
        <button className="btn-primary w-full">Sign in with Google</button>
      </form>
    </main>
  );
}
