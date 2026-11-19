// All money is stored as integer pesewas (1 GHS = 100 pesewas).
export type Pesewas = number & { readonly __brand: "Pesewas" };

export function toPesewas(ghs: string): Pesewas {
  // TODO (you): accept "12", "12.5", "12.50". Reject "12.555", "-3", "abc".
  // Hint: split on "." and check the decimal part is 0 to 2 digits.
  throw new Error("not implemented");
}

export function formatGHS(p: Pesewas): string {
  // TODO (you): return "GH₵ 12.50"
  throw new Error("not implemented");
}