import { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  detectFormat,
  type EditorDocument,
  type EditorCommand,
} from "@document-studio/core";
import {
  DocumentEditor,
  type DocumentEditorHandle,
  type DocumentSavedEvent,
} from "@document-studio/react";
import { docxEngine } from "@document-studio/engine-docx";
import { rhwpEngine } from "@document-studio/engine-rhwp";
import "../../../packages/react/src/styles.css";
import "./app.css";

const engines = [
  docxEngine(),
  rhwpEngine({
    studioUrl: `${import.meta.env.BASE_URL}editor-assets/rhwp/index.html`,
  }),
];
function App() {
  const [documents, setDocuments] = useState<EditorDocument[]>([]);
  const [selected, setSelected] = useState<EditorDocument | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [nextDocument, setNextDocument] = useState<EditorDocument | null>(null);
  const [switchDialog, setSwitchDialog] = useState(false);
  const [switching, setSwitching] = useState(false);
  // Async file reads must consult the current workspace, not the render which started them.
  const selectedRef = useRef<EditorDocument | null>(null);
  const documentsRef = useRef<EditorDocument[]>([]);
  const dirtyRef = useRef(false);
  const switchingRef = useRef(false);
  const editor = useRef<DocumentEditorHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const select = (document: EditorDocument | null) => {
    selectedRef.current = document;
    dirtyRef.current = false;
    setSelected(document);
  };
  const remember = (document: EditorDocument) => {
    const current = documentsRef.current;
    const next = current.some((item) => item.id === document.id)
      ? current.map((item) => (item.id === document.id ? document : item))
      : [...current, document];
    documentsRef.current = next;
    setDocuments(next);
  };
  const choose = (document: EditorDocument) => {
    if (switchingRef.current) return;
    const current = selectedRef.current;
    if (current?.id === document.id) return;
    const retained =
      documentsRef.current.find((item) => item.id === document.id) ?? document;
    const state = editor.current?.getState();
    const dirty =
      state && state.documentId === current?.id && state.ready
        ? state.dirty
        : dirtyRef.current;
    if (current && dirty) {
      setNextDocument(retained);
      setSwitchDialog(true);
    } else {
      select(retained);
    }
  };
  const acceptSaved = (saved: DocumentSavedEvent) => {
    const original = documentsRef.current.find(
      (item) => item.id === saved.documentId,
    );
    if (!original) return;
    const retained: EditorDocument = {
      ...original,
      bytes: saved.bytes,
      version: saved.version,
      recovered: false,
    };
    remember(retained);
    if (selectedRef.current?.id === saved.documentId) {
      selectedRef.current = retained;
      setSelected(retained);
    }
  };
  const switchDocument = async () => {
    const current = selectedRef.current;
    const target = nextDocument;
    const handle = editor.current;
    if (!current || !target || !handle || switchingRef.current) return;
    switchingRef.current = true;
    setSwitching(true);
    setError("");
    try {
      await handle.flushDraft();
      // Changing the key is safe only after the latest draft transaction has committed.
      select(
        documentsRef.current.find((item) => item.id === target.id) ?? target,
      );
      setNextDocument(null);
      setSwitchDialog(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      switchingRef.current = false;
      setSwitching(false);
    }
  };
  async function open(bytes: Uint8Array, fileName: string) {
    const format = detectFormat(fileName);
    if (bytes.byteLength > 32 * 1024 * 1024)
      throw new Error("첫 버전의 문서 크기 제한은 32 MiB입니다.");
    if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b)
      throw new Error("올바른 ZIP 기반 HWPX 또는 DOCX 파일이 아닙니다.");
    const hash = await crypto.subtle.digest(
      "SHA-256",
      new Uint8Array(bytes).buffer,
    );
    const id = `${fileName}:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    const document: EditorDocument = {
      id,
      fileName,
      format,
      bytes,
      version: id,
    };
    if (!documentsRef.current.some((item) => item.id === id))
      remember(document);
    choose(document);
  }
  async function sample(format: "docx" | "hwpx") {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `${import.meta.env.BASE_URL}samples/sample.${format}`,
      );
      if (!response.ok) throw new Error("예제 문서를 불러오지 못했습니다.");
      await open(
        new Uint8Array(await response.arrayBuffer()),
        `예제 문서.${format}`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }
  async function preset(commands: EditorCommand[]) {
    try {
      for (const command of commands) await editor.current?.execute(command);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  return (
    <div className="studio-app">
      <aside className="studio-sidebar">
        <a className="studio-brand" href="./">
          <span className="studio-brand-mark">D</span>
          <span>
            Document<span className="studio-brand-sub">STUDIO</span>
          </span>
        </a>
        <button
          className="studio-open"
          onClick={() => fileInput.current?.click()}
        >
          <span>＋</span>문서 열기
        </button>
        <input
          hidden
          ref={fileInput}
          aria-label="문서 파일"
          type="file"
          accept=".hwpx,.docx"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setLoading(true);
            setError("");
            void file
              .arrayBuffer()
              .then((bytes) => open(new Uint8Array(bytes), file.name))
              .catch((cause) =>
                setError(
                  cause instanceof Error ? cause.message : String(cause),
                ),
              )
              .finally(() => setLoading(false));
          }}
        />
        <div className="studio-sidebar-label">
          내 문서 <span>{documents.length}</span>
        </div>
        <nav aria-label="열린 문서">
          {documents.map((document) => (
            <button
              key={document.id}
              className={`studio-file ${selected?.id === document.id ? "active" : ""}`}
              onClick={() => choose(document)}
            >
              <span className="studio-file-icon">▤</span>
              <span>
                {document.fileName}
                <small>{document.format.toUpperCase()}</small>
              </span>
            </button>
          ))}
        </nav>
        {selected && (
          <div className="studio-presets">
            <div className="studio-sidebar-label">빠른 서식</div>
            <p>선택한 영역에 적용합니다.</p>
            <button
              onClick={() =>
                preset([
                  { id: "fontSize", value: 16 },
                  { id: "lineSpacing", value: 1.5 },
                  { id: "alignCenter" },
                ])
              }
            >
              제목 서식 <span>16pt · 가운데</span>
            </button>
            <button
              onClick={() =>
                preset([
                  { id: "fontSize", value: 12 },
                  { id: "lineSpacing", value: 1.6 },
                  { id: "alignLeft" },
                ])
              }
            >
              보고서 본문 <span>12pt · 행간 160%</span>
            </button>
            <button
              onClick={() =>
                preset([
                  { id: "fontSize", value: 10 },
                  { id: "lineSpacing", value: 1.3 },
                  { id: "alignLeft" },
                ])
              }
            >
              각주와 설명 <span>10pt · 행간 130%</span>
            </button>
          </div>
        )}
        <div className="studio-sidebar-footer">
          <span className="studio-local-dot" />
          파일은 이 브라우저에서 편집됩니다.<small>HWPX · DOCX</small>
        </div>
      </aside>
      <main className="studio-main">
        <div className="studio-topbar">
          <div>
            <span className="studio-breadcrumb">WORKSPACE</span>
            <h1>문서 작업실</h1>
          </div>
          <span className="studio-local-label">로컬 편집</span>
        </div>
        {error && (
          <div className="studio-app-error" role="alert">
            {error}
            <button aria-label="메시지 닫기" onClick={() => setError("")}>
              ×
            </button>
          </div>
        )}
        {loading && (
          <div className="studio-app-loading" role="status">
            문서를 준비하는 중…
          </div>
        )}
        <div className="studio-workspace">
          {selected ? (
            <DocumentEditor
              ref={editor}
              key={selected.id}
              document={selected}
              engines={engines}
              draftNamespace="playground"
              onDirtyChange={(dirty) => {
                dirtyRef.current = dirty;
              }}
              onSaved={acceptSaved}
              onCreateDocument={(document) => {
                remember(document);
                choose(document);
              }}
              onClose={() => select(null)}
            />
          ) : (
            <div className="studio-welcome">
              <span className="studio-welcome-icon">▤</span>
              <div className="studio-eyebrow">
                YOUR DOCUMENTS, ONE WORKSPACE
              </div>
              <h2>문서에 집중하는 공간</h2>
              <p>
                HWPX와 Word 문서를 같은 화면에서 편집하세요.
                <br />
                파일을 열고 서식을 정리한 뒤 원본 형식으로 저장할 수 있습니다.
              </p>
              <button
                className="studio-welcome-open"
                onClick={() => fileInput.current?.click()}
              >
                문서 열기 <span>↗</span>
              </button>
              <div className="studio-samples">
                <span>예제로 먼저 살펴보기</span>
                <button disabled={loading} onClick={() => sample("hwpx")}>
                  HWPX 예제 →
                </button>
                <button disabled={loading} onClick={() => sample("docx")}>
                  DOCX 예제 →
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
      {switchDialog && (
        <div className="studio-global-modal">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="studio-switch-title"
          >
            <h3 id="studio-switch-title">다른 문서를 열까요?</h3>
            <p>
              저장하지 않은 변경사항이 있습니다. 문서를 전환하면 최신 초안을 이
              브라우저에 보관합니다.
            </p>
            <button disabled={switching} onClick={() => setSwitchDialog(false)}>
              계속 편집
            </button>
            <button
              disabled={switching}
              onClick={() => {
                void editor.current
                  ?.exportDocument()
                  .then(async (result) => {
                    const { downloadDocument } = await import(
                      "@document-studio/react"
                    );
                    downloadDocument(
                      result.bytes,
                      selected!.fileName,
                      result.format,
                    );
                  })
                  .catch((cause) => setError(String(cause)));
              }}
            >
              초안 다운로드
            </button>
            <button
              disabled={switching}
              onClick={() => {
                void switchDocument();
              }}
            >
              문서 전환
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
