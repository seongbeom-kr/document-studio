import { expect, it } from "vitest";
import { createTemplateAuthoringSession } from "../../packages/react/src/template-authoring-session";
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
it("only emits the newest user selection when native captures complete out of order", async () => {
  const a = deferred<string>(),
    b = deferred<string>(),
    received: string[] = [];
  let call = 0;
  const session = createTemplateAuthoringSession({
    capture: () => (++call === 1 ? a.promise : b.promise),
    highlight: async () => {},
    onSelection: (v) => received.push(v),
    onError: () => {},
  });
  const first = session.capture(),
    second = session.capture();
  b.resolve("second");
  await second;
  a.resolve("first");
  await first;
  expect(received).toEqual(["second"]);
});
it("permits the same selection again after clear without emitting during highlight", async () => {
  const received: string[] = [];
  const session = createTemplateAuthoringSession({
    capture: async () => "same",
    highlight: async () => {},
    onSelection: (v) => received.push(v),
    onError: () => {},
  });
  await session.capture();
  await session.highlight(null);
  await session.capture();
  expect(received).toEqual(["same", "same"]);
});
it("selects a previous native target again after the host highlights a different target", async () => {
  const received: string[] = [];
  const session = createTemplateAuthoringSession({
    capture: async () => "A",
    highlight: async () => {},
    onSelection: (value) => received.push(value),
    onError: () => {},
  });
  await session.capture();
  await session.highlight("A");
  await session.highlight("B");
  await session.capture();
  expect(received).toEqual(["A", "A"]);
});
it("does not cancel a newer user capture when an earlier selection is echoed by controlled props", async () => {
  const pending = deferred<string>(),
    received: string[] = [];
  let reads = 0;
  const session = createTemplateAuthoringSession({
    capture: () => (++reads === 1 ? Promise.resolve("A") : pending.promise),
    highlight: async () => {},
    onSelection: (value) => received.push(value),
    onError: () => {},
  });
  await session.capture();
  const second = session.capture();
  await session.highlight("A");
  pending.resolve("B");
  await second;
  expect(received).toEqual(["A", "B"]);
});
it("ignores old document responses after disposal and serializes reverse highlights", async () => {
  const capture = deferred<string>(),
    paint = deferred<void>(),
    received: string[] = [],
    painted: (string | null)[] = [];
  const session = createTemplateAuthoringSession({
    capture: () => capture.promise,
    highlight: async (v) => {
      if (v === "old") await paint.promise;
      painted.push(v);
    },
    onSelection: (v) => received.push(v),
    onError: () => {},
  });
  const pending = session.capture(),
    first = session.highlight("old"),
    last = session.highlight(null);
  paint.resolve();
  await first;
  await last;
  expect(painted).toEqual(["old", null]);
  session.dispose();
  capture.resolve("old document");
  await pending;
  expect(received).toEqual([]);
});
