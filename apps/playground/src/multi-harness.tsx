import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { EditorCommand, EditorDocument } from "@document-studio/core";
import {
  DocumentEditor,
  type DocumentEditorHandle,
} from "@document-studio/react";
import { docxEngine } from "@document-studio/engine-docx";
import { rhwpEngine } from "@document-studio/engine-rhwp";
import "../../../packages/react/src/styles.css";
const engines = [
  docxEngine(),
  rhwpEngine({ studioUrl: "/editor-assets/rhwp/index.html" }),
];
declare global {
  interface Window {
    documentStudioMulti: {
      state(
        index: number,
      ): ReturnType<DocumentEditorHandle["getState"]> | undefined;
      execute(index: number, command: EditorCommand): Promise<void>;
      export(index: number): Promise<number[]>;
      saves: number[];
    };
  }
}
function MultiHarness() {
  const refs = [
    useRef<DocumentEditorHandle>(null),
    useRef<DocumentEditorHandle>(null),
  ];
  const [documents, setDocuments] = useState<EditorDocument[]>([]);
  useEffect(() => {
    window.documentStudioMulti = {
      state: (index) => refs[index]?.current?.getState(),
      execute: async (index, command) => {
        await refs[index]!.current!.execute(command);
      },
      export: async (index) =>
        Array.from((await refs[index]!.current!.exportDocument()).bytes),
      saves: [0, 0],
    };
    void Promise.all(
      (["docx", "hwpx"] as const).map(async (format) => ({
        id: `multi:${format}`,
        fileName: `sample.${format}`,
        format,
        bytes: new Uint8Array(
          await (await fetch(`/samples/sample.${format}`)).arrayBuffer(),
        ),
        version: "v1",
      })),
    ).then(setDocuments);
  }, []);
  return (
    <main style={{ display: "flex", height: "100dvh", gap: 16 }}>
      {documents.map((document, index) => (
        <div key={document.id} style={{ width: "50%", minWidth: 0 }}>
          <DocumentEditor
            ref={refs[index]}
            document={document}
            engines={engines}
            draftStore={false}
            storage={{
              save: async () => ({
                version: `v${++window.documentStudioMulti.saves[index]! + 1}`,
              }),
            }}
          />
        </div>
      ))}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<MultiHarness />);
