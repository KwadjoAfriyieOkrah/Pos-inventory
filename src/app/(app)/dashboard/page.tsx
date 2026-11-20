import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/server/auth";
import { DashboardScreen } from "@/features/dashboard/DashboardScreen";

async function SignedInContent() {
  // Reads the visitor's session cookie. Marking it as request-time work
  // keeps Next.js from prerendering or caching one user's page for others.
  await connection();

  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  return <DashboardScreen />;
}

export default function DashboardPage() {
  return (
    <main className="w-full">
      <Suspense fallback={<p>Loading your session…</p>}>
        <SignedInContent />
      </Suspense>
    </main>
  );
}