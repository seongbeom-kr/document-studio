import { afterEach, expect, it, vi } from "vitest";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
it("loads v3 validation without runtime code generation", async () => {
  vi.resetModules();
  const blocked = () => {
    throw new EvalError("unsafe-eval blocked by the host CSP");
  };
  vi.stubGlobal(
    "Function",
    new Proxy(Function, { construct: blocked, apply: blocked }),
  );
  const { validateContractV3 } = await import(
    "../../packages/template/src/v3/contract"
  );
  expect(() => validateContractV3("artifact", {})).toThrow(
    "REPORT_INVALID_V3_CONTRACT:artifact",
  );
});
