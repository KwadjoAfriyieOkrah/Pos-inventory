// DEMO DATA, delete before go-live.
export type DemoStockBatch = {
  id: string;
  medicineId: string;
  batchNumber: string;
  expiryDate: string;
  quantityOnHand: number;
  unitCostPesewas: number;
};

export const DEMO_TODAY = "2026-11-20";

export const DEMO_STOCK_BATCHES = [
  {
    id: "batch-paracetamol-2407",
    medicineId: "paracetamol-500",
    batchNumber: "PCM-2407",
    expiryDate: "2026-10-28",
    quantityOnHand: 12,
    unitCostPesewas: 280,
  },
  {
    id: "batch-amoxicillin-1138",
    medicineId: "amoxicillin-500",
    batchNumber: "AMX-1138",
    expiryDate: "2026-11-19",
    quantityOnHand: 34,
    unitCostPesewas: 1250,
  },
  {
    id: "batch-cetirizine-8102",
    medicineId: "cetirizine-10",
    batchNumber: "CTZ-8102",
    expiryDate: "2026-11-29",
    quantityOnHand: 18,
    unitCostPesewas: 610,
  },
  {
    id: "batch-ors-5091",
    medicineId: "oral-rehydration",
    batchNumber: "ORS-5091",
    expiryDate: "2026-12-10",
    quantityOnHand: 52,
    unitCostPesewas: 390,
  },
  {
    id: "batch-ibuprofen-2240",
    medicineId: "ibuprofen-200",
    batchNumber: "IBU-2240",
    expiryDate: "2027-01-01",
    quantityOnHand: 9,
    unitCostPesewas: 480,
  },
  {
    id: "batch-cough-1703",
    medicineId: "cough-mixture",
    batchNumber: "HCM-1703",
    expiryDate: "2027-01-15",
    quantityOnHand: 16,
    unitCostPesewas: 2200,
  },
  {
    id: "batch-antacid-6327",
    medicineId: "antacid-suspension",
    batchNumber: "ANT-6327",
    expiryDate: "2027-02-01",
    quantityOnHand: 26,
    unitCostPesewas: 1850,
  },
  {
    id: "batch-hydrocortisone-4055",
    medicineId: "hydrocortisone-cream",
    batchNumber: "HYD-4055",
    expiryDate: "2027-06-30",
    quantityOnHand: 7,
    unitCostPesewas: 950,
  },
  {
    id: "batch-paracetamol-2510",
    medicineId: "paracetamol-500",
    batchNumber: "PCM-2510",
    expiryDate: "2027-02-16",
    quantityOnHand: 78,
    unitCostPesewas: 300,
  },
  {
    id: "batch-amoxicillin-1194",
    medicineId: "amoxicillin-500",
    batchNumber: "AMX-1194",
    expiryDate: "2027-03-20",
    quantityOnHand: 11,
    unitCostPesewas: 1320,
  },
  {
    id: "batch-cetirizine-8244",
    medicineId: "cetirizine-10",
    batchNumber: "CTZ-8244",
    expiryDate: "2027-04-15",
    quantityOnHand: 43,
    unitCostPesewas: 640,
  },
  {
    id: "batch-ors-5176",
    medicineId: "oral-rehydration",
    batchNumber: "ORS-5176",
    expiryDate: "2027-08-31",
    quantityOnHand: 5,
    unitCostPesewas: 410,
  },
] as const satisfies readonly DemoStockBatch[];
