import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const source = await readFile(
  new URL(
    "../../packages/engine-rhwp/assets/document-studio-extension.js",
    import.meta.url,
  ),
  "utf8",
);
function fixture() {
  const commands = new Map<
    string,
    { execute(services: unknown, params: unknown): void }
  >();
  const subscriptions = new Map<string, ((reason?: unknown) => void)[]>();
  const messages: {
    type: string;
    state: { revision: number; context: { isDirty: boolean } };
  }[] = [];
  let start!: () => void;
  let dirty = false;
  const services = {
    eventBus: {
      on(name: string, handler: (reason?: unknown) => void) {
        subscriptions.set(name, [...(subscriptions.get(name) ?? []), handler]);
      },
    },
    getInputHandler: () => undefined,
    getContext: () => ({ isDirty: dirty }),
    wasm: { pageCount: 1 },
  };
  runInNewContext(source, {
    URL,
    location: {
      href: "https://editor.example/?documentStudioOrigin=https://host.example",
    },
    document: {
      documentElement: {},
      querySelectorAll: () => [],
      addEventListener() {},
    },
    window: {
      addEventListener() {},
      parent: {
        postMessage: (message: (typeof messages)[number]) =>
          messages.push(message),
      },
      rhwpStudio: {
        automation: {
          registerCommand(command: {
            id: string;
            execute(services: unknown, params: unknown): void;
          }) {
            commands.set(command.id, command);
          },
        },
      },
    },
    MutationObserver: class {
      observe() {}
    },
    setInterval: (callback: () => void) => {
      start = callback;
      return 1;
    },
    clearInterval() {},
    queueMicrotask,
  });
  start();
  const state = () => {
    commands.get("ext:document-studio:state")!.execute(services, {});
    return messages.at(-1)!.state;
  };
  state();
  return {
    state,
    messages,
    emit(name: string, reason?: unknown) {
      if (name === "document-mutated" || name === "document-changed")
        dirty = true;
      for (const handler of subscriptions.get(name) ?? []) handler(reason);
    },
  };
}

describe("HWPX native revision signals", () => {
  it.each([
    ["document-changed", "deferred-pagination-flush:idle-auto"],
    ["document-changed", "deferred-pagination-complete"],
    ["document-mutated", "input-handler-resumable-pagination"],
  ])("does not count layout-only %s/%s as a new edit", (event, reason) => {
    const test = fixture();
    test.emit("document-mutated", "input-handler-edit");
    const before = test.state().revision;
    test.emit(event, reason);
    expect(test.state().revision).toBe(before);
    test.emit("document-mutated", "input-handler-edit");
    expect(test.state().revision).toBe(before + 1);
  });
  it("still counts unknown change reasons conservatively", () => {
    const test = fixture();
    test.emit("document-changed", "future-edit-reason");
    expect(test.state().revision).toBe(1);
  });
  it("increments synchronously for page-local mutations without a full render event", async () => {
    const test = fixture();
    test.emit("document-mutated");
    expect(test.state()).toMatchObject({
      revision: 1,
      context: { isDirty: true },
    });
    await Promise.resolve();
    expect(
      test.messages.find(
        (message) => message.type === "document-studio:changed",
      )?.state.revision,
    ).toBe(1);
  });
  it("still observes commands that emit only the legacy full-change signal", () => {
    const test = fixture();
    test.emit("document-changed");
    expect(test.state().revision).toBe(1);
  });
  it("does not add duplicate subscriptions on repeated state reads", () => {
    const test = fixture();
    test.state();
    test.state();
    test.emit("document-mutated");
    expect(test.state().revision).toBe(1);
  });
  it("keeps tokens monotonic for combined signals and ignores selection-only changes", () => {
    const test = fixture();
    test.emit("document-mutated");
    const mutation = test.state().revision;
    test.emit("document-changed");
    const rendered = test.state().revision;
    expect(rendered).toBeGreaterThan(mutation);
    test.emit("selection-changed");
    test.emit("document-page-invalidated");
    expect(test.state().revision).toBe(rendered);
  });
});
