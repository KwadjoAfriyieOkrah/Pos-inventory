import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { exchangeTerminalRegistrationCode } from "./actions";

type RegistrationPageProps = {
  searchParams: Promise<{ message?: string | string[] }>;
};

async function RegistrationForm({
  searchParams,
}: RegistrationPageProps) {
  // Reads the URL's message parameter, which only exists on a real request.
  await connection();
  const params = await searchParams;
  const message = Array.isArray(params.message)
    ? params.message[0]
    : params.message;

  async function registerDevice(formData: FormData) {
    "use server";

    const code = formData.get("registrationCode");
    const result = await exchangeTerminalRegistrationCode(
      typeof code === "string" ? code : "",
    );

    if (result.ok) redirect("/login");
    redirect(`/register?message=${encodeURIComponent(result.message)}`);
  }

  return (
    <section className="w-full max-w-sm space-y-6">
      <h1 className="text-2xl font-semibold">Register device</h1>
      <form action={registerDevice} className="space-y-4">
        <div className="space-y-2">
          <label
            htmlFor="registrationCode"
            className="block text-sm font-medium"
          >
            Registration code
          </label>
          <input
            id="registrationCode"
            name="registrationCode"
            type="text"
            autoComplete="off"
            spellCheck={false}
            required
            className="w-full rounded-md border px-3 py-2"
          />
        </div>
        <div aria-live="polite" aria-atomic="true">
          {message && (
            <p role="alert" className="text-sm text-red-600">
              {message}
            </p>
          )}
        </div>
        <button
          type="submit"
          className="w-full rounded-md bg-black px-3 py-2 text-white"
        >
          Register device
        </button>
      </form>
    </section>
  );
}

export default function RegistrationPage({
  searchParams,
}: RegistrationPageProps) {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-12">
      <Suspense fallback={<p>Loading…</p>}>
        <RegistrationForm searchParams={searchParams} />
      </Suspense>
    </main>
  );
}