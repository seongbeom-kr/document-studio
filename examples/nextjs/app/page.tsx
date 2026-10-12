"use client";
import { useMemo, useRef, useState } from "react";
import {
  DocumentEditor,
  browserAutomationDraftStore,
  type DocumentEditorHandle,
} from "@document-studio/react";
import { detectFormat, type EditorDocument } from "@document-studio/core";
import { docxEngine } from "@document-studio/engine-docx";
import { rhwpEngine } from "@document-studio/engine-rhwp";
export default function Page() {
  const engines = useMemo(
    () => [
      docxEngine(),
      rhwpEngine({ studioUrl: "/editor-assets/rhwp/index.html" }),
    ],
    [],
  );
  const [document, setDocument] = useState<EditorDocument | null>(null);
  const automationDrafts = useMemo(() => browserAutomationDraftStore(), []);
  const [error, setError] = useState("");
  const editor = useRef<DocumentEditorHandle>(null);
  return (
    <main
      style={{
        height: "100dvh",
        padding: 24,
        fontFamily: "sans-serif",
        boxSizing: "border-box",
      }}
    >
      {document ? (
        <DocumentEditor
          key={document.id}
          ref={editor}
          document={document}
          engines={engines}
          draftNamespace="next-example"
          automationDraftStore={automationDrafts}
          onSaved={(saved) =>
            setDocument((current) =>
              current?.id === saved.documentId
                ? {
                    ...current,
                    bytes: saved.bytes,
                    version: saved.version,
                    recovered: false,
                  }
                : current,
            )
          }
          onClose={() => setDocument(null)}
          onCreateDocument={async (next) => {
            await editor.current?.flushDraft();
            setDocument(next);
          }}
        />
      ) : (
        <>
          <h1>Document Studio</h1>
          <p>Next.js에서 배포 패키지를 삽입하는 예제입니다.</p>
          <input
            aria-label="문서 파일"
            type="file"
            accept=".docx,.hwpx"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void (async () => {
                try {
                  const bytes = new Uint8Array(await file.arrayBuffer());
                  setDocument({
                    id: `${file.name}:${file.lastModified}`,
                    fileName: file.name,
                    format: detectFormat(file.name),
                    bytes,
                  });
                } catch (cause) {
                  setError(String(cause));
                }
              })();
            }}
          />
          {error && <p role="alert">{error}</p>}
        </>
      )}
    </main>
  );
}
