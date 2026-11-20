// DEMO DATA, delete before go-live.
import { DEMO_CATALOG } from "@/features/demo/catalog";

type DemoMedicineId = (typeof DEMO_CATALOG)[number]["id"];

export type DemoTopMedicine = {
  medicineId: DemoMedicineId;
  unitsSold: number;
};

export type DemoBranchFigures = {
  id: string;
  name: string;
  salesTodayCount: number;
  salesTodayTotalPesewas: number;
  topMedicinesThisWeek: readonly DemoTopMedicine[];
};

export const DEMO_BRANCHES = [
  {
    id: "demo-branch-a",
    name: "Demo Branch A",
    salesTodayCount: 42,
    salesTodayTotalPesewas: 167540,
    topMedicinesThisWeek: [
      { medicineId: "paracetamol-500", unitsSold: 86 },
      { medicineId: "amoxicillin-500", unitsSold: 53 },
      { medicineId: "cetirizine-10", unitsSold: 41 },
      { medicineId: "oral-rehydration", unitsSold: 35 },
      { medicineId: "ibuprofen-200", unitsSold: 28 },
    ],
  },
  {
    id: "demo-branch-b",
    name: "Demo Branch B",
    salesTodayCount: 29,
    salesTodayTotalPesewas: 128920,
    topMedicinesThisWeek: [
      { medicineId: "paracetamol-500", unitsSold: 62 },
      { medicineId: "cetirizine-10", unitsSold: 47 },
      { medicineId: "cough-mixture", unitsSold: 31 },
      { medicineId: "amoxicillin-500", unitsSold: 30 },
      { medicineId: "antacid-suspension", unitsSold: 24 },
    ],
  },
] as const satisfies readonly DemoBranchFigures[];
