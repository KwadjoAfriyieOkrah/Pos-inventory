import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AppShell } from "@/features/shell/AppShell";
import { SignOutButton } from "@/features/shell/SignOutButton";
import { auth } from "@/server/auth";

async function SignedInShell({ children }: { children: ReactNode }) {
  await connection();

  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  if (typeof session.user.email !== "string") {
    throw new Error("Authenticated session is missing the user's email.");
  }

  return (
    <AppShell email={session.user.email} signOutButton={<SignOutButton />}>
      {children}
    </AppShell>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#f6f6f1]" aria-label="Loading session" />
      }
    >
      <SignedInShell>{children}</SignedInShell>
    </Suspense>
  );
}
