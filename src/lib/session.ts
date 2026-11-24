import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

/** Data-access guard. Call at the top of every page and server action. */
export async function requireUser() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");
  return session.user;
}
