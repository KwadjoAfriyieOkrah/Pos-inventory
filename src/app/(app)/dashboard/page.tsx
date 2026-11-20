import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/server/auth";

async function SignedInContent() {
  // Reads the visitor's session cookie. Marking it as request-time work
  // keeps Next.js from prerendering or caching one user's page for others.
  await connection();

  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>Signed in</h1>
      <p style={{ marginTop: 16 }}>
        Signed in as {session.user.email}.
      </p>
      <p style={{ marginTop: 12, color: "#555" }}>
        Medicine inventory and sales screens are built in a later phase.
      </p>
    </>
  );
}

export default function DashboardPage() {
  return (
    <main style={{ maxWidth: 480, margin: "120px auto", padding: "0 16px" }}>
      <Suspense fallback={<p>Loading your session…</p>}>
        <SignedInContent />
      </Suspense>
    </main>
  );
}