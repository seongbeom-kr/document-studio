import { describe, expect, it } from "vitest";

const studioUrl = new URL(
  "https://editor.test/runtime/index.html?secret=private",
);

function frameFixture(
  input: {
    connected?: boolean;
    documentUrl?: string | null;
    readyState?: DocumentReadyState;
    scripts?: string[];
    resources?: { name: string; responseEnd: number }[];
    inaccessible?: boolean;
  } = {},
) {
  const document =
    input.documentUrl === null
      ? null
      : {
          readyState: input.readyState ?? "complete",
          location: { href: input.documentUrl ?? "about:blank" },
          querySelectorAll: () => (input.scripts ?? []).map((src) => ({ src })),
        };
  const frame = {
    isConnected: input.connected ?? true,
    parentElement: { isConnected: input.connected ?? true },
    get contentDocument() {
      if (input.inaccessible) throw new Error("private browser error");
      return document;
    },
    contentWindow: {
      performance: { getEntriesByType: () => input.resources ?? [] },
    },
  };
  return frame as unknown as HTMLIFrameElement;
}

// A missing sampler is an assertion failure; the rest exercises its observable output.
async function sample(frame: HTMLIFrameElement) {
  const implementation = await import(
    "../../packages/engine-rhwp/src/frame-diagnostics"
  );
  return implementation.readRhwpFrameState(frame, studioUrl);
}

describe("privacy-safe HWPX frame diagnostics", () => {
  it("distinguishes a stalled HTML response from a document that has started parsing", async () => {
    await expect(sample(frameFixture())).resolves.toEqual({
      connected: true,
      containerConnected: true,
      navigation: "initial-blank",
      documentReadyState: "complete",
      bootScript: "absent",
    });
    await expect(
      sample(
        frameFixture({
          documentUrl: "https://editor.test/runtime/index.html?bootId=private",
          readyState: "loading",
          scripts: ["https://editor.test/runtime/document-studio-boot.js"],
        }),
      ),
    ).resolves.toEqual({
      connected: true,
      containerConnected: true,
      navigation: "expected-runtime",
      documentReadyState: "loading",
      bootScript: "present-no-completion",
    });
  });

  it("records a detached parent without inventing a readable document", async () => {
    await expect(
      sample(frameFixture({ connected: false, documentUrl: null })),
    ).resolves.toEqual({
      connected: false,
      containerConnected: false,
      navigation: "unavailable",
      documentReadyState: "unavailable",
      bootScript: "unavailable",
    });
  });

  it("distinguishes completed boot resource loading from script execution", async () => {
    await expect(
      sample(
        frameFixture({
          documentUrl: "https://editor.test/runtime/index.html",
          readyState: "interactive",
          scripts: ["https://editor.test/runtime/document-studio-boot.js"],
          resources: [
            {
              name: "https://editor.test/runtime/document-studio-boot.js",
              responseEnd: 42,
            },
          ],
        }),
      ),
    ).resolves.toMatchObject({
      navigation: "expected-runtime",
      documentReadyState: "interactive",
      bootScript: "resource-finished",
    });
  });

  it("does not inspect scripts or resources on an unexpected document", async () => {
    const frame = frameFixture({
      documentUrl: "https://editor.test/login?token=private",
    });
    Object.defineProperty(frame.contentDocument, "querySelectorAll", {
      value: () => {
        throw new Error("unexpected document inspected");
      },
    });
    await expect(sample(frame)).resolves.toMatchObject({
      navigation: "other",
      bootScript: "unavailable",
    });
  });

  it("sanitizes inaccessible document state without exposing errors or URLs", async () => {
    const result = await sample(frameFixture({ inaccessible: true }));
    expect(result).toEqual({
      connected: true,
      containerConnected: true,
      navigation: "inaccessible",
      documentReadyState: "inaccessible",
      bootScript: "inaccessible",
    });
    expect(JSON.stringify(result)).not.toMatch(/private|https?:|secret|token/);
  });
});
