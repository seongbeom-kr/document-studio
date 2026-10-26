import type { EngineInitializationFrameDiagnostics } from "@document-studio/core";

/** Read only bounded state from our frame; never retain URLs, document contents or errors. */
export function readRhwpFrameState(
  frame: HTMLIFrameElement,
  studioUrl: URL,
): EngineInitializationFrameDiagnostics {
  const state: EngineInitializationFrameDiagnostics = {
    connected: frame.isConnected,
    containerConnected: Boolean(frame.parentElement?.isConnected),
    navigation: "unavailable",
    documentReadyState: "unavailable",
    bootScript: "unavailable",
  };
  try {
    const document = frame.contentDocument;
    // contentDocument is null for both detached and cross-origin frames. The
    // guarded location access distinguishes the latter without recording it.
    const href = document?.location.href ?? frame.contentWindow?.location?.href;
    if (!href) return state;
    const currentUrl = new URL(href);
    state.documentReadyState = document?.readyState ?? "unavailable";
    if (href === "about:blank") {
      state.navigation = "initial-blank";
      state.bootScript = "absent";
      return state;
    }
    if (
      currentUrl.origin !== studioUrl.origin ||
      currentUrl.pathname !== studioUrl.pathname
    ) {
      state.navigation = "other";
      return state;
    }
    state.navigation = "expected-runtime";
    if (!document) return state;
    const bootUrl = new URL("./document-studio-boot.js", studioUrl);
    const script = Array.from(
      document.querySelectorAll<HTMLScriptElement>("script[src]"),
    ).find((candidate) => {
      const source = new URL(candidate.src);
      return (
        source.origin === bootUrl.origin && source.pathname === bootUrl.pathname
      );
    });
    if (!script) {
      state.bootScript = "absent";
      return state;
    }
    state.bootScript = "present-no-completion";
    const completed = frame.contentWindow?.performance
      .getEntriesByType("resource")
      .some(
        (entry) =>
          entry.name === script.src &&
          "responseEnd" in entry &&
          typeof entry.responseEnd === "number" &&
          entry.responseEnd > 0,
      );
    if (completed) state.bootScript = "resource-finished";
  } catch {
    state.navigation = "inaccessible";
    state.documentReadyState = "inaccessible";
    state.bootScript = "inaccessible";
  }
  return state;
}
