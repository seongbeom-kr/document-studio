import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  DocumentEditor,
  type DocumentEditorHandle,
} from "@document-studio/react";
import { docxEngine } from "@document-studio/engine-docx";
import { rhwpEngine } from "@document-studio/engine-rhwp";
import type { EditorDocument, DocumentStorage } from "@document-studio/core";
import "../../../packages/react/src/styles.css";
function ReviewHost() {
  const format =
    new URL(location.href).searchParams.get("format") === "hwpx"
      ? "hwpx"
      : "docx";
  const [document, setDocument] = useState<EditorDocument | null>(null);
  const [target, setTarget] = useState("first-file");
  const [savedTarget, setSavedTarget] = useState("");
  const [savedDocument, setSavedDocument] = useState("");
  const ref = useRef<DocumentEditorHandle>(null);
  const engines = useMemo(
    () => [
      docxEngine(),
      rhwpEngine({ studioUrl: "/editor-assets/rhwp/index.html" }),
    ],
    [],
  );
  const storage = useMemo<DocumentStorage>(
    () => ({
      save: async (input) => {
        setSavedTarget(target);
        setSavedDocument(input.document.id);
        return { version: "v2" };
      },
    }),
    [target],
  );
  useEffect(() => {
    void fetch(`/samples/blank.${format}`)
      .then((r) => r.arrayBuffer())
      .then((bytes) =>
        setDocument({
          id: "first-file",
          fileName: `first.${format}`,
          format,
          version: "v1",
          bytes: new Uint8Array(bytes),
        }),
      );
  }, []);
  return (
    <main style={{ height: "100dvh" }}>
      <button
        onClick={() => {
          setTarget("second-file");
          setDocument({
            id: "second-file",
            fileName: `corrupt.${format}`,
            format,
            version: "v1",
            bytes: new Uint8Array([1, 2, 3]),
          });
        }}
      >
        Supply corrupt second source
      </button>
      <output aria-label="host saved target">{savedTarget}</output>
      <output aria-label="host saved document">{savedDocument}</output>
      {document && (
        <DocumentEditor
          ref={ref}
          document={document}
          engines={engines}
          storage={storage}
          draftStore={false}
        />
      )}
    </main>
  );
}
createRoot(window.document.getElementById("root")!).render(<ReviewHost />);
