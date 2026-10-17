import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rhwpEngine } from "../../packages/engine-rhwp/src/index";
import {
  patchRhwpLifecycle,
  rhwpLifecyclePatch,
} from "../../scripts/rhwp-lifecycle-patch.mjs";

const sourceUrl = new URL(
  "../../node_modules/@rhwp/editor/index.js",
  import.meta.url,
);
const source = await readFile(sourceUrl, "utf8");
it.each([
  "D:/sdk/node_modules/@rhwp/editor/index.js",
  "D:/sdk/node_modules/@rhwp/editor/index.js?v=dependency-version",
  "/home/runner/node_modules/@rhwp/editor/index.js?v=dependency-version",
])(
  "applies the initialization patch to production and versioned dev module %s",
  (id) => {
    const plugin = rhwpLifecyclePatch();
    const result = plugin.transform(source, id);
    expect(result?.code).toContain("onInitializationStage");
    expect(result?.code).toContain("rejectLoad");
    expect(() => plugin.generateBundle()).not.toThrow();
  },
);
const patched = patchRhwpLifecycle(source).replaceAll(
  /from '(\.\/[^']+)'/g,
  (_: string, relative: string) =>
    `from '${new URL(relative, sourceUrl).href}'`,
);
const upstream = await import(
  /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(patched).toString("base64")}`
);

class Frame extends EventTarget {
  style = {};
  src = "";
  allow = "";
  removed = false;
  listeners = new Set<string>();
  contentWindow = { postMessage: vi.fn() };
  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ) {
    this.listeners.add(type);
    super.addEventListener(type, listener, options);
  }
  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: EventListenerOptions | boolean,
  ) {
    this.listeners.delete(type);
    super.removeEventListener(type, listener, options);
  }
  remove() {
    this.removed = true;
  }
}

function fixture(mode: "load" | "connect" | "ready" | "chrome" | "success") {
  vi.useFakeTimers();
  const frame = new Frame();
  const messages: string[] = [];
  const channels: {
    closed: boolean;
    onmessage: ((event: { data: unknown }) => void) | null;
  }[] = [];
  class Channel {
    port1 = {
      closed: false,
      onmessage: null as ((event: { data: unknown }) => void) | null,
      start() {},
      close() {
        this.closed = true;
      },
      postMessage: (message: {
        method: string;
        id: number;
        sessionId: string;
      }) => {
        messages.push(message.method);
        if (mode === "chrome" && message.method === "chrome.set") return;
        queueMicrotask(() =>
          this.port1.onmessage?.({
            data: {
              type: "rhwp-response",
              version: 1,
              id: message.id,
              sessionId: message.sessionId,
              result: message.method === "ready" ? mode !== "ready" : {},
            },
          }),
        );
      },
    };
    port2 = {};
    constructor() {
      channels.push(this.port1);
      frame.contentWindow.postMessage.mockImplementation(
        (message: { sessionId: string }) => {
          if (mode === "connect") return;
          queueMicrotask(() =>
            this.port1.onmessage?.({
              data: {
                type: "rhwp-connected",
                version: 1,
                sessionId: message.sessionId,
                capabilities: ["transferable-array-buffer"],
              },
            }),
          );
        },
      );
    }
  }
  vi.stubGlobal("MessageChannel", Channel);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", { createElement: () => frame });
  const container = {
    appendChild: vi.fn(() => {
      if (mode !== "load")
        queueMicrotask(() => frame.dispatchEvent(new Event("load")));
    }),
  };
  return { frame, container, channels, messages, abort: new AbortController() };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("pinned RHWP initialization cancellation", () => {
  it("accepts only the same frame, origin and boot attempt while load is still pending", async () => {
    const f = fixture("load"),
      stages: string[] = [];
    const task = upstream.createStudio(f.container, {
      studioUrl: "https://editor.test/?documentStudioBootId=current",
      signal: f.abort.signal,
      chrome: { menu: false },
      onFrameReady: (via: string) => stages.push(via),
    });
    const send = (origin: string, source: unknown, bootId: string) =>
      window.dispatchEvent(
        Object.assign(new Event("message"), {
          origin,
          source,
          data: { type: "document-studio:frame-ready", bootId },
        }),
      );
    send("https://untrusted.test", f.frame.contentWindow, "current");
    send("https://editor.test", {}, "current");
    send("https://editor.test", f.frame.contentWindow, "expired");
    await Promise.resolve();
    expect(stages).toEqual([]);
    expect(f.messages).toEqual([]);
    send("https://editor.test", f.frame.contentWindow, "current");
    const editor = await task;
    expect(stages).toEqual(["runtime"]);
    expect(f.messages).toEqual(["ready", "chrome.set"]);
    expect(f.frame.listeners.size).toBe(0);
    editor.destroy();
  });
  it.each([0, -1, 999, 120001, 1000.5, Infinity, NaN])(
    "rejects an invalid whole-boot deadline: %s",
    (initializationTimeoutMs) => {
      expect(() =>
        rhwpEngine({ studioUrl: "/editor/", initializationTimeoutMs }),
      ).toThrow(RangeError);
    },
  );
  it("keeps engine identity stable for equivalent options and separates different deadlines", () => {
    const first = rhwpEngine({ studioUrl: "/editor/" });
    expect(
      rhwpEngine({ studioUrl: "/editor/", initializationTimeoutMs: 30000 }),
    ).toBe(first);
    expect(
      rhwpEngine({ studioUrl: "/editor/", initializationTimeoutMs: 4000 }),
    ).not.toBe(first);
  });
  it("fails closed when the dependency source changes", () => {
    expect(() => patchRhwpLifecycle(source + "\n")).toThrow("source changed");
  });
  it("rejects an already cancelled boot without appending a frame", async () => {
    const f = fixture("load");
    f.abort.abort(new Error("cancelled before start"));
    await expect(
      upstream.createStudio(f.container, {
        studioUrl: "https://editor.test/",
        signal: f.abort.signal,
      }),
    ).rejects.toThrow("cancelled before start");
    expect(f.container.appendChild).not.toHaveBeenCalled();
    expect(f.frame.listeners.size).toBe(0);
  });
  it.each(["load", "connect", "ready", "chrome"] as const)(
    "settles and releases resources while %s is stalled",
    async (mode) => {
      const f = fixture(mode);
      const task = upstream.createStudio(f.container, {
        studioUrl: "https://editor.test/",
        signal: f.abort.signal,
        chrome: { menu: false },
      });
      const result = expect(task).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(10);
      f.abort.abort(new Error("whole boot deadline"));
      await result;
      expect(f.frame.removed).toBe(true);
      expect(f.frame.listeners.size).toBe(0);
      expect(
        f.channels.every(
          (channel) => channel.closed && channel.onmessage === null,
        ),
      ).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      const calls = f.messages.length;
      await vi.advanceTimersByTimeAsync(60000);
      expect(f.messages).toHaveLength(calls);
      // A late load cannot resume transport creation after cancellation.
      const connects = f.frame.contentWindow.postMessage.mock.calls.length;
      f.frame.dispatchEvent(new Event("load"));
      await Promise.resolve();
      expect(f.frame.contentWindow.postMessage).toHaveBeenCalledTimes(connects);
    },
  );
  it("cleans up an iframe load error", async () => {
    const f = fixture("load");
    const task = upstream.createStudio(f.container, {
      studioUrl: "https://editor.test/",
      signal: f.abort.signal,
    });
    f.frame.dispatchEvent(new Event("error"));
    await expect(task).rejects.toThrow("iframe failed");
    expect(f.frame.removed).toBe(true);
    expect(f.frame.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("completes a healthy boot and leaves lifecycle cleanup to its owner", async () => {
    const f = fixture("success");
    const editor = await upstream.createStudio(f.container, {
      studioUrl: "https://editor.test/",
      signal: f.abort.signal,
      chrome: { menu: false },
    });
    expect(f.messages).toEqual(["ready", "chrome.set"]);
    expect(f.frame.removed).toBe(false);
    expect(f.frame.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    editor.destroy();
    expect(f.frame.removed).toBe(true);
    expect(f.channels.every((channel) => channel.closed)).toBe(true);
  });
});
