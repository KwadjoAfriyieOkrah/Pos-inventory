// DEMO DATA, delete before go-live.
export type DemoMedicine = {
  id: string;
  name: string;
  dosageForm: string;
  unitPricePesewas: number;
};

export const DEMO_CATALOG = [
  {
    id: "paracetamol-500",
    name: "Paracetamol",
    dosageForm: "500 mg tablets",
    unitPricePesewas: 450,
  },
  {
    id: "amoxicillin-500",
    name: "Amoxicillin",
    dosageForm: "500 mg capsules",
    unitPricePesewas: 1850,
  },
  {
    id: "cetirizine-10",
    name: "Cetirizine",
    dosageForm: "10 mg tablets",
    unitPricePesewas: 920,
  },
  {
    id: "oral-rehydration",
    name: "Oral Rehydration Salts",
    dosageForm: "Powder sachet",
    unitPricePesewas: 600,
  },
  {
    id: "ibuprofen-200",
    name: "Ibuprofen",
    dosageForm: "200 mg tablets",
    unitPricePesewas: 780,
  },
  {
    id: "cough-mixture",
    name: "Herbal Cough Mixture",
    dosageForm: "100 ml syrup",
    unitPricePesewas: 3200,
  },
  {
    id: "antacid-suspension",
    name: "Antacid Suspension",
    dosageForm: "200 ml oral suspension",
    unitPricePesewas: 2750,
  },
  {
    id: "hydrocortisone-cream",
    name: "Hydrocortisone",
    dosageForm: "1% cream",
    unitPricePesewas: 1450,
  },
] as const satisfies readonly DemoMedicine[];
