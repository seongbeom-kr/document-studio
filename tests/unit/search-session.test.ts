import { expect, it } from "vitest";
import { SearchSession } from "../../packages/react/src/search-session";

it("rejects a late search response at an unchanged document revision", () => {
  const session = new SearchSession();
  session.updateContext("document:0:old-query");
  const older = session.beginSearch();
  session.updateContext("document:0:new-query");
  const newer = session.beginSearch();
  expect(session.current(newer)).toBe(true);
  expect(session.current(older)).toBe(false);
});
it("prefers the latest repeated search with identical conditions", () => {
  const session = new SearchSession();
  session.updateContext("same");
  const older = session.beginSearch(),
    newer = session.beginSearch();
  expect(session.current(older)).toBe(false);
  expect(session.current(newer)).toBe(true);
});
it("invalidates a pending selection when query or document identity changes", () => {
  const session = new SearchSession();
  session.updateContext("one");
  session.beginSearch();
  const selected = session.beginSelection();
  session.updateContext("two");
  expect(session.current(selected)).toBe(false);
});
it("retains the result batch but rejects earlier selection responses", () => {
  const session = new SearchSession();
  session.updateContext("one");
  const result = session.beginSearch();
  const first = session.beginSelection(),
    second = session.beginSelection();
  expect(session.current(result)).toBe(true);
  expect(session.current(first)).toBe(false);
  expect(session.current(second)).toBe(true);
});
it("does not revive cancelled work when the same context reappears", () => {
  const session = new SearchSession();
  session.updateContext("one");
  const old = session.beginSearch();
  session.invalidate();
  session.updateContext("one");
  expect(session.current(old)).toBe(false);
});
