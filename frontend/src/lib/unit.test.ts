import { describe, test, expect } from "bun:test";
import { normalizeUnit, unitsMatch } from "./unit";

describe("normalizeUnit", () => {
  test("null/undefined/empty → ''", () => {
    expect(normalizeUnit(null)).toBe("");
    expect(normalizeUnit(undefined)).toBe("");
    expect(normalizeUnit("")).toBe("");
  });

  test("m² variations → 'm2'", () => {
    expect(normalizeUnit("m²")).toBe("m2");
    expect(normalizeUnit("M²")).toBe("m2");
    expect(normalizeUnit("m2")).toBe("m2");
    expect(normalizeUnit("M2")).toBe("m2");
  });

  test("m³ variations → 'm3'", () => {
    expect(normalizeUnit("m³")).toBe("m3");
    expect(normalizeUnit("M³")).toBe("m3");
    expect(normalizeUnit("m3")).toBe("m3");
  });

  test("trim whitespace", () => {
    expect(normalizeUnit(" kg ")).toBe("kg");
    expect(normalizeUnit("\tkg\n")).toBe("kg");
  });

  test("und/unid → 'un'", () => {
    expect(normalizeUnit("und")).toBe("un");
    expect(normalizeUnit("UND")).toBe("un");
    expect(normalizeUnit("Unid")).toBe("un");
    expect(normalizeUnit("unid")).toBe("un");
    expect(normalizeUnit("un")).toBe("un");
  });

  test("idempotent", () => {
    expect(normalizeUnit(normalizeUnit("M²"))).toBe("m2");
  });
});

describe("unitsMatch", () => {
  test("equal normalized", () => {
    expect(unitsMatch("m²", "m2")).toBe(true);
    expect(unitsMatch("M²", "m2")).toBe(true);
    expect(unitsMatch("und", "un")).toBe(true);
    expect(unitsMatch("kg", "KG")).toBe(true);
  });

  test("different", () => {
    expect(unitsMatch("m2", "m3")).toBe(false);
    expect(unitsMatch("kg", "un")).toBe(false);
  });

  test("null handling", () => {
    expect(unitsMatch(null, null)).toBe(true);
    expect(unitsMatch("kg", null)).toBe(false);
  });
});
