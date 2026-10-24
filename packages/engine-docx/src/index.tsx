import { lazy, Suspense } from "react";
import type { EngineDefinition, EngineViewProps } from "@document-studio/react";
import type { FontResolver } from "@docx-editor.dev/core/editor";
const DocxView = lazy(() =>
  import("./docx-view").then((module) => ({ default: module.DocxView })),
);
function LazyDocxView(props: EngineViewProps & DocxFontOptions) {
  return (
    <Suspense
      fallback={<p className="ds-loading">DOCX 편집기를 준비하는 중…</p>}
    >
      <DocxView {...props} />
    </Suspense>
  );
}
export interface DocxFontOptions {
  /** Shared self-hosted font pack; defaults to /editor-assets/fonts/. */
  fontBaseUrl?: string;
  /** Optional licensed original fonts. Faces it supplies take precedence over the portable pack. */
  fontResolver?: FontResolver;
}
const definitions = new Map<string, EngineDefinition>();
const customDefinitions = new WeakMap<
  FontResolver,
  Map<string, EngineDefinition>
>();
export function docxEngine(options: DocxFontOptions = {}): EngineDefinition {
  const key = options.fontBaseUrl ?? "";
  const cache = options.fontResolver
    ? (customDefinitions.get(options.fontResolver) ??
      new Map<string, EngineDefinition>())
    : definitions;
  if (options.fontResolver) customDefinitions.set(options.fontResolver, cache);
  if (cache.has(key)) return cache.get(key)!;
  const configuration = { ...options };
  const engine: EngineDefinition = {
    id: "docx",
    formats: ["docx"],
    View: (props) => <LazyDocxView {...props} {...configuration} />,
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
  cache.set(key, engine);
  return engine;
}
export async function createDocxDocument(
  template: import("@document-studio/core").DocumentTemplate,
) {
  return (await import("./templates")).createDocxDocument(template);
}
