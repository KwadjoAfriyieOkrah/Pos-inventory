// All money is stored as integer pesewas (1 GHS = 100 pesewas).
// Never use floating-point arithmetic for money.
export type Pesewas = number & { readonly __brand: "Pesewas" };

const GHS_PATTERN = /^(\d+)(?:\.(\d{1,2}))?$/;

// Accepts "12", "12.5", "12.50". Rejects "12.555", "-3", "abc", "".
export function toPesewas(ghs: string): Pesewas {
  const match = GHS_PATTERN.exec(ghs.trim());
  if (!match) {
    throw new Error("Invalid amount: use digits with at most two decimals.");
  }

  const whole = Number(match[1]);
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const pesewas = whole * 100 + Number(fraction);

  if (!Number.isSafeInteger(pesewas)) {
    throw new Error("Amount is too large.");
  }

  return pesewas as Pesewas;
}

// Returns "GH₵ 12.50" for 1250. Integer arithmetic only.
export function formatGHS(p: Pesewas): string {
  const whole = Math.trunc(p / 100);
  const cents = p % 100;
  return `GH₵ ${whole}.${String(cents).padStart(2, "0")}`;
}