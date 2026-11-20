import type { DemoMedicine } from "@/features/demo/catalog";

export type CartLine = {
  id: string;
  name: string;
  dosageForm: string;
  unitPricePesewas: number;
  quantity: number;
};

const QUANTITY_ERROR = "Quantity must be a whole number from 1 to 99.";

function assertQuantity(quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    throw new RangeError(QUANTITY_ERROR);
  }
}

function assertPesewas(pesewas: number) {
  if (!Number.isSafeInteger(pesewas) || pesewas < 0) {
    throw new RangeError("Money amounts must be non-negative integer pesewas.");
  }
}

export function addCartLine(
  lines: readonly CartLine[],
  medicine: DemoMedicine,
  quantity = 1,
): CartLine[] {
  assertQuantity(quantity);
  assertPesewas(medicine.unitPricePesewas);

  const existingLine = lines.find((line) => line.id === medicine.id);

  if (existingLine) {
    return updateCartLineQuantity(
      lines,
      medicine.id,
      existingLine.quantity + quantity,
    );
  }

  return [
    ...lines,
    {
      id: medicine.id,
      name: medicine.name,
      dosageForm: medicine.dosageForm,
      unitPricePesewas: medicine.unitPricePesewas,
      quantity,
    },
  ];
}

export function updateCartLineQuantity(
  lines: readonly CartLine[],
  id: string,
  quantity: number,
): CartLine[] {
  assertQuantity(quantity);

  if (!lines.some((line) => line.id === id)) {
    throw new Error(`Cart line not found: ${id}`);
  }

  return lines.map((line) => (line.id === id ? { ...line, quantity } : line));
}

export function removeCartLine(
  lines: readonly CartLine[],
  id: string,
): CartLine[] {
  return lines.filter((line) => line.id !== id);
}

export function getLineTotalPesewas(line: CartLine): number {
  assertQuantity(line.quantity);
  assertPesewas(line.unitPricePesewas);

  const lineTotal = line.unitPricePesewas * line.quantity;
  if (!Number.isSafeInteger(lineTotal)) {
    throw new RangeError("Line total exceeds the supported money range.");
  }

  return lineTotal;
}

export function getCartTotalPesewas(lines: readonly CartLine[]): number {
  return lines.reduce((total, line) => {
    const nextTotal = total + getLineTotalPesewas(line);
    if (!Number.isSafeInteger(nextTotal)) {
      throw new RangeError("Cart total exceeds the supported money range.");
    }

    return nextTotal;
  }, 0);
}

export function getChangePesewas(
  totalPesewas: number,
  tenderedPesewas: number,
): number {
  assertPesewas(totalPesewas);
  assertPesewas(tenderedPesewas);

  if (tenderedPesewas < totalPesewas) {
    throw new RangeError("Tendered amount must cover the sale total.");
  }

  return tenderedPesewas - totalPesewas;
}

export function parsePesewasInput(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const wholeDigits = match[1].replace(/^0+(?=\d)/, "");
  if (wholeDigits.length > 13) {
    return null;
  }

  const wholePesewas = Number(wholeDigits) * 100;
  const fractionalPesewas = Number((match[2] ?? "").padEnd(2, "0") || "0");
  const amount = wholePesewas + fractionalPesewas;

  return Number.isSafeInteger(amount) ? amount : null;
}
