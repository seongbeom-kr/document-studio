import { lazy, Suspense } from "react";
import type { EngineDefinition, EngineViewProps } from "@document-studio/react";
const DocxView = lazy(() =>
  import("./docx-view").then((module) => ({ default: module.DocxView })),
);
function LazyDocxView(props: EngineViewProps) {
  return (
    <Suspense
      fallback={<p className="ds-loading">DOCX 편집기를 준비하는 중…</p>}
    >
      <DocxView {...props} />
    </Suspense>
  );
}
export function docxEngine(): EngineDefinition {
  return {
    id: "docx",
    formats: ["docx"],
    View: LazyDocxView,
    validateDocument: async (document, signal) => {
      const { runValidationWorker } = await import("@document-studio/core");
      return runValidationWorker(
        new Worker(new URL("./validation-worker.ts", import.meta.url), {
          type: "module",
        }),
        { bytes: document.bytes },
        signal,
      );
    },
    createDocument: async (template) =>
      (await import("./templates")).createDocxDocument(template),
  };
}
export async function createDocxDocument(
  template: import("@document-studio/core").DocumentTemplate,
) {
  return (await import("./templates")).createDocxDocument(template);
}
