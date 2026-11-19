// Each data function names its permission at the call site; role names are never checked in code.
export const PERMISSIONS = {
  saleCreate: "sale.create",
  saleVoid: "sale.void",
  saleRefund: "sale.refund",
  priceOverride: "price.override",
  batchOverride: "batch.override",
  stockReceive: "stock.receive",
  stockAdjust: "stock.adjust",
  transferInitiate: "transfer.initiate",
  transferReceive: "transfer.receive",
  reportViewBranch: "report.view_branch",
  reportViewAll: "report.view_all",
  medicineEdit: "medicine.edit",
  userManage: "user.manage",
  auditView: "audit.view",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
