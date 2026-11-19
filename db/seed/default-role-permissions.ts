import { PERMISSIONS, type Permission } from "../../src/server/data/permissions";

export const DEFAULT_ROLE_PERMISSIONS: Record<
  "cashier" | "pharmacist" | "owner",
  Permission[]
> = {
  cashier: [PERMISSIONS.saleCreate, PERMISSIONS.reportViewBranch],
  pharmacist: [
    PERMISSIONS.saleCreate,
    PERMISSIONS.saleVoid,
    PERMISSIONS.saleRefund,
    PERMISSIONS.priceOverride,
    PERMISSIONS.batchOverride,
    PERMISSIONS.transferInitiate,
    PERMISSIONS.auditView,
    PERMISSIONS.reportViewBranch,
  ],
  owner: [
    PERMISSIONS.saleCreate,
    PERMISSIONS.saleVoid,
    PERMISSIONS.saleRefund,
    PERMISSIONS.priceOverride,
    PERMISSIONS.stockReceive,
    PERMISSIONS.stockAdjust,
    PERMISSIONS.transferInitiate,
    PERMISSIONS.reportViewBranch,
    PERMISSIONS.reportViewAll,
    PERMISSIONS.medicineEdit,
    PERMISSIONS.userManage,
    PERMISSIONS.auditView,
  ],
};
