import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

/** Comma-separated so you can add a second account later if you ever need to. */
function allowlist(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google], // reads AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 90 }, // stay signed in on your phone
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    signIn({ profile }) {
      const email = profile?.email?.toLowerCase();
      return !!email && profile?.email_verified !== false && allowlist().includes(email);
    },
  },
});
