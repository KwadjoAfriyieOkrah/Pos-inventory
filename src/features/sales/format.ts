export function formatPesewas(pesewas: number): string {
  if (!Number.isSafeInteger(pesewas) || pesewas < 0) {
    throw new RangeError("Money amounts must be non-negative integer pesewas.");
  }

  const digits = String(pesewas).padStart(3, "0");
  const whole = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = digits.slice(-2);

  return `GH₵ ${whole}.${fraction}`;
}
