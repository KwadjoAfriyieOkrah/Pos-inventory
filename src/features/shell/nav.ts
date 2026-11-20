export type NavigationItem = {
  label: string;
  href: `/${string}`;
};

export const NAV_ITEMS = [
  { label: "Sales", href: "/sales" },
  { label: "Stock", href: "/stock" },
  { label: "Dashboard", href: "/dashboard" },
] as const satisfies readonly NavigationItem[];
