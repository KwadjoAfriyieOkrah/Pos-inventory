import { signOutAction } from "@/app/(app)/actions";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button
        className="inline-flex min-h-11 items-center rounded-full border border-stone-300 px-4 text-sm font-medium text-stone-700 transition hover:border-stone-500 hover:text-stone-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
        type="submit"
      >
        Sign out
      </button>
    </form>
  );
}
