// Early, bounded boot observations. Never include document text, errors, tokens or URL queries.
(() => {
  const params = new URL(location.href).searchParams;
  const bootId = params.get("documentStudioBootId");
  const parentOrigin = params.get("documentStudioOrigin");
  if (!bootId || !parentOrigin || !/^https?:\/\//.test(parentOrigin)) return;
  let count = 0;
  const report = (event) => {
    if (++count > 48) return;
    parent.postMessage(
      {
        type: "document-studio:boot",
        bootId,
        event,
        width: innerWidth,
        height: innerHeight,
        visibility: document.visibilityState,
      },
      parentOrigin,
    );
  };
  report("script-start");
  addEventListener("DOMContentLoaded", () => report("dom-ready"), {
    once: true,
  });
  addEventListener("load", () => report("window-loaded"), { once: true });
  addEventListener(
    "error",
    (event) =>
      report(event.target instanceof Element ? "asset-error" : "script-error"),
    true,
  );
  addEventListener("unhandledrejection", () => report("promise-error"));
  addEventListener("resize", () => report("viewport-changed"));
  addEventListener("pagehide", () => report("page-hidden"), { once: true });
  document.addEventListener("visibilitychange", () =>
    report("visibility-changed"),
  );
})();
