import { PERMISSIONS, type Permission } from "@/server/data/permissions";

export type NavigationItem = {
  label: string;
  href: `/${string}`;
  permission?: Permission;
};

export const NAV_ITEMS = [
  { label: "Sales", href: "/sales" },
  { label: "Sales history", href: "/sales/history" },
  { label: "Void approvals", href: "/sales/voids", permission: PERMISSIONS.saleVoid },
  { label: "Stock", href: "/stock" },
  { label: "Dashboard", href: "/dashboard" },
] as const satisfies readonly NavigationItem[];
