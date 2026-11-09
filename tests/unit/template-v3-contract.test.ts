import { describe, expect, it } from "vitest";
import * as sdk from "../../packages/template/src/index";
import valid from "../../packages/template/contracts/v3/fixtures/valid.json";
import invalid from "../../packages/template/contracts/v3/fixtures/invalid.json";

const api = sdk as unknown as {
  validateContractV3(kind: string, value: unknown): void;
  canonicalV3(value: unknown): string;
};

describe("portable report v3 contracts", () => {
  for (const fixture of valid)
    it(fixture.name, () => {
      expect(() =>
        api.validateContractV3(fixture.kind, fixture.value),
      ).not.toThrow();
    });
  for (const fixture of invalid)
    it(fixture.name, () => {
      expect(() =>
        api.validateContractV3(fixture.kind, fixture.value),
      ).toThrowError(/^REPORT_INVALID_V3_CONTRACT/);
    });
  it("canonicalizes keys without changing Unicode or array order", () => {
    expect(api.canonicalV3({ z: -0, a: [1, "가"] })).toBe(
      '{"a":[1,"가"],"z":0}',
    );
  });
  it("requires decimal strings and rejects unsafe integers", () => {
    expect(() => api.canonicalV3({ n: 1.25 })).toThrowError(
      /^REPORT_INVALID_CANONICAL_JSON/,
    );
    expect(() =>
      api.canonicalV3({ n: Number.MAX_SAFE_INTEGER + 1 }),
    ).toThrowError(/^REPORT_INVALID_CANONICAL_JSON/);
  });
  it("sorts numeric property names lexically across languages", () => {
    expect(api.canonicalV3({ "2": "two", "10": "ten" })).toBe(
      '{"10":"ten","2":"two"}',
    );
  });
  it("uses the same UTF-16 ordering for non-BMP keys", () => {
    expect(api.canonicalV3({ "\uffff": 1, "😀": 2 })).toBe(
      '{"😀":2,"\uffff":1}',
    );
  });
});
