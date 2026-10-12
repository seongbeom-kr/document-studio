import { it, expect } from "vitest";
import { reconcilePropertyDraft } from "../../packages/react/src/property-draft";
it("retains edits to other properties while a shared toolbar updates the live line spacing", () => {
  const next = reconcilePropertyDraft(
    {
      selection: "p1",
      base: { beforePt: 0, lineSpacing: { rule: "multiple", value: 1.6 } },
      edits: { beforePt: 6 },
    },
    { beforePt: 0, lineSpacing: { rule: "multiple", value: 1.5 } },
    "p1",
  );
  expect(next.edits).toEqual({ beforePt: 6 });
  expect(next.base.lineSpacing.value).toBe(1.5);
});
it("discards a pending value when the same property changes externally", () => {
  expect(
    reconcilePropertyDraft(
      { selection: "p1", base: { beforePt: 0 }, edits: { beforePt: 6 } },
      { beforePt: 12 },
      "p1",
    ).edits,
  ).toEqual({});
});
it("does not apply the previous paragraph's pending values after the selection moves", () => {
  expect(
    reconcilePropertyDraft(
      { selection: "p1", base: { beforePt: 0 }, edits: { beforePt: 6 } },
      { beforePt: 12 },
      "p2",
    ).edits,
  ).toEqual({});
});
