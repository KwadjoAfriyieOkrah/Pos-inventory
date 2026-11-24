"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { NAV_ITEMS } from "./nav";

type AppShellProps = {
  children: ReactNode;
  email: string;
  signOutButton: ReactNode;
  permissions: readonly string[];
};

function Navigation({
  mobile = false,
  permissions,
}: {
  mobile?: boolean;
  permissions: readonly string[];
}) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter(
    (item) => !("permission" in item) || permissions.includes(item.permission),
  );

  return (
    <nav aria-label="Primary navigation">
      <ul className={mobile ? "grid grid-cols-3 gap-1" : "space-y-2"}>
        {items.map((item, index) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <li key={item.href}>
              <Link
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition ${
                  active
                    ? "bg-teal-800 text-white shadow-sm"
                    : "text-stone-600 hover:bg-stone-200/70 hover:text-stone-950"
                } ${mobile ? "flex-col justify-center gap-0.5 px-1 py-1 text-xs" : ""}`}
                href={item.href}
              >
                <span
                  aria-hidden="true"
                  className={`font-mono text-[10px] ${
                    active ? "text-teal-100" : "text-stone-400"
                  }`}
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function AppShell({
  children,
  email,
  signOutButton,
  permissions,
}: AppShellProps) {
  return (
    <div className="min-h-screen bg-[#f6f6f1] text-stone-950 md:flex">
      <aside className="hidden w-72 shrink-0 flex-col border-r border-stone-200 bg-[#efefe8] px-6 py-7 md:flex">
        <div className="mb-14 flex items-center gap-3">
          <div
            aria-hidden="true"
            className="flex size-11 items-center justify-center rounded-2xl bg-teal-800 text-lg font-semibold text-white"
          >
            P
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight">Pharmacy POS</p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-500">
              Operations
            </p>
          </div>
        </div>

        <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-400">
          Workspace
        </p>
        <Navigation permissions={permissions} />

        <div className="mt-auto border-t border-stone-300 pt-5">
          <p className="text-xs leading-relaxed text-stone-500">
            A clear view of your pharmacy, from the counter to the storeroom.
          </p>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="flex min-h-[76px] items-center justify-between gap-4 border-b border-stone-200 bg-[#f6f6f1]/90 px-5 md:px-10">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-400 md:hidden">
              Pharmacy POS
            </p>
            <p className="truncate text-sm font-medium text-stone-700">
              {email}
            </p>
          </div>
          {signOutButton}
        </header>

        <div className="mx-auto w-full max-w-7xl px-5 py-8 md:px-10 md:py-12">
          {children}
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-stone-200 bg-[#f6f6f1]/95 px-3 pb-[env(safe-area-inset-bottom)] pt-2 backdrop-blur md:hidden">
        <Navigation mobile permissions={permissions} />
      </div>
    </div>
  );
}
