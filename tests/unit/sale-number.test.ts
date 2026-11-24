import { describe, expect, it } from "vitest";
import { branchCodeFromName } from "../../src/lib/sale-number";

describe("branchCodeFromName", () => {
  it("uses the final letter of the trimmed branch name", () => {
    expect(branchCodeFromName("Demo Branch A")).toBe("A");
    expect(branchCodeFromName("Demo Branch B")).toBe("B");
  });

  it("rejects a branch name ending in a non-letter", () => {
    expect(() => branchCodeFromName("Demo Branch 1")).toThrow(
      "Branch name must end with a letter to derive a branch code.",
    );
  });
});
