export type NavigationItem = {
  label: string;
  href: `/${string}`;
};

export const NAV_ITEMS = [
  { label: "Sales", href: "/sales" },
  { label: "Sales history", href: "/sales/history" },
  { label: "Stock", href: "/stock" },
  { label: "Dashboard", href: "/dashboard" },
] as const satisfies readonly NavigationItem[];
