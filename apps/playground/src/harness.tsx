import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  SaveConflictError,
  browserDraftStore,
  draftKey,
  inspectExport,
  type EditorCommand,
  type EditorDocument,
  type EditorSnapshot,
  type DocumentStorage,
  type DraftStore,
  type DocumentTemplate,
} from "@document-studio/core";
import {
  DocumentEditor,
  createAgentBridge,
  browserAutomationDraftStore,
  type AutomationDraftStore,
  type DocumentEditorHandle,
  type DocumentSavedEvent,
  type EngineViewProps,
} from "@document-studio/react";
import { docxEngine } from "@document-studio/engine-docx";
import { rhwpEngine } from "@document-studio/engine-rhwp";
import "../../../packages/react/src/styles.css";
const rhwpOptions = {
  studioUrl: "/editor-assets/rhwp/index.html",
  initializationTimeoutMs: Number(
    new URLSearchParams(window.location.search).get(
      "rhwpInitializationTimeoutMs",
    ) ?? 30000,
  ),
};
const engines = [docxEngine(), rhwpEngine(rhwpOptions)];
function FaultInjectionView(props: EngineViewProps) {
  const View = engines.find((engine) =>
    engine.formats.includes(props.document.format),
  )!.View;
  return (
    <View
      {...props}
      onReady={(session) =>
        props.onReady({
          ...session,
          executePreset: session.executePreset
            ? async (commands, options) => {
                const api = window.documentStudioTest;
                api.commandsStarted.push("preset");
                if (api.pauseNextCommand) {
                  api.pauseNextCommand = false;
                  await new Promise<void>((resolve) => {
                    api.releasePausedCommand = resolve;
                  });
                }
                if (api.failPausedCommand)
                  throw new Error("테스트 이전 명령 실패");
                options.assertCurrent();
                await session.executePreset!(commands, options);
              }
            : undefined,
          execute: async (command, options) => {
            const api = window.documentStudioTest;
            api.commandsStarted.push(command.id);
            if (api.pauseNextCommand) {
              api.pauseNextCommand = false;
              await new Promise<void>((resolve) => {
                api.releasePausedCommand = resolve;
              });
            }
            if (api.failPausedCommand) throw new Error("테스트 이전 명령 실패");
            await session.execute(command, options);
          },
          exportDocument: async () => {
            const api = window.documentStudioTest;
            api.exportAttempts++;
            if (api.failExports > 0) {
              api.failExports--;
              throw new SaveConflictError("테스트 직렬화 중 revision 변경");
            }
            return session.exportDocument();
          },
          markSaved: async (revision) => {
            if (window.documentStudioTest.failEngineAcknowledgement)
              throw new Error("테스트 엔진 저장 후처리 실패");
            await session.markSaved(revision);
          },
        })
      }
    />
  );
}
declare global {
  interface Window {
    documentStudioTest: {
      state(): ReturnType<DocumentEditorHandle["getState"]> | undefined;
      agent: ReturnType<typeof createAgentBridge>;
      execute(
        command: EditorCommand,
        options?: { expectedRevision?: string },
      ): Promise<void>;
      export(): Promise<number[]>;
      inspectBytes(
        bytes: number[],
        format: "docx" | "hwpx",
      ): ReturnType<typeof inspectExport>;
      save(options?: { onlyIfDirty?: boolean }): Promise<void>;
      flushAutomationDraft(): Promise<void>;
      acquireInputLock(): Promise<void>;
      releaseInputLock(): Promise<void>;
      flushDraft(): Promise<void>;
      closeAfterDraft(): Promise<void>;
      load(format: "docx" | "hwpx", name?: string): Promise<void>;
      loadBytes(bytes: number[], format: "docx" | "hwpx"): void;
      createTemplate(
        format: "docx" | "hwpx",
        template: DocumentTemplate,
      ): Promise<void>;
      updateVersion(version: string): void;
      acknowledgeSavedSource(): void;
      replaceSameVersion(): void;
      rerender(): void;
      setDraftPolicy(mode: "primary" | "secondary" | "off"): void;
      seedDraft(
        format: "docx" | "hwpx",
        name: string,
        text?: string,
        corrupt?: boolean,
        secondary?: boolean,
      ): Promise<void>;
      storedDraft(name: string, secondary?: boolean): Promise<number[] | null>;
      draftGetDelay: number;
      draftGets: number;
      failDraftReads: boolean;
      failExports: number;
      exportAttempts: number;
      failEngineAcknowledgement: boolean;
      readOnly: boolean;
      pauseNextCommand: boolean;
      failPausedCommand: boolean;
      releasePausedCommand?: () => void;
      commandsStarted: string[];
      presetFailure?: {
        message: string;
        completedCommands?: number;
        totalCommands?: number;
      };
      embedded: boolean;
      persistAutomation: boolean;
      failAutomationWrites: boolean;
      failAutomationReads: boolean;
      automationNamespace: string;
      automationStore: AutomationDraftStore;
      retainSavedSource: boolean;
      stateEvents: EditorSnapshot[];
      failSavedCallback: boolean;
      failCreatedCallback: boolean;
      creationEnabled: boolean;
      createdIds: string[];
      creationsCompleted: number;
      pauseNextCreation: boolean;
      releasePausedCreation?: () => void;
      failDraftStorage: boolean;
      draftsDisabled: boolean;
      draftDelay: number;
      draftWrites: number;
      draftStarts: number;
      savedEvent:
        | (Omit<DocumentSavedEvent, "bytes"> & { bytes: number[] })
        | null;
      saved: number[];
      mode:
        | "success"
        | "failure"
        | "conflict"
        | "delayed"
        | "warning"
        | "invalid-version";
      fixedSaveVersion?: string;
      saves: number;
      expectedVersions: (string | undefined)[];
    };
  }
}
function Harness() {
  const [document, setDocument] = useState<EditorDocument | null>(null);
  const editor = useRef<DocumentEditorHandle>(null);
  const inputLocks = useRef<(() => Promise<void>)[]>([]);
  const [closed, setClosed] = useState(false);
  const [, setRender] = useState(0);
  const [draftPolicy, setDraftPolicy] = useState<
    "primary" | "secondary" | "off"
  >("primary");
  const browserDrafts = useRef(browserDraftStore());
  const automationDrafts = useRef(browserAutomationDraftStore());
  const automationAdapter = useRef<AutomationDraftStore>({
    get: async (key) => {
      if (window.documentStudioTest.failAutomationReads)
        throw new Error("테스트 자동화 조회 실패");
      return automationDrafts.current.get(key);
    },
    put: async (key, value) => {
      if (window.documentStudioTest.failAutomationWrites)
        throw new Error("테스트 자동화 용량 초과");
      await automationDrafts.current.put(key, value);
    },
    delete: (key) => automationDrafts.current.delete(key),
  });
  const secondaryDrafts = useRef(browserDraftStore("sdk-secondary-drafts"));
  const drafts = useRef<DraftStore>({
    get: async (key) => {
      const api = window.documentStudioTest;
      api.draftGets++;
      if (api.failDraftReads) throw new Error("테스트 초안 조회 실패");
      if (api.draftGetDelay)
        await new Promise((resolve) => setTimeout(resolve, api.draftGetDelay));
      return browserDrafts.current.get(key);
    },
    delete: (key) => browserDrafts.current.delete(key),
    put: async (draft) => {
      const api = window.documentStudioTest;
      api.draftStarts++;
      if (api.failDraftStorage) throw new Error("테스트 초안 저장 용량 초과");
      if (api.draftDelay)
        await new Promise((resolve) => setTimeout(resolve, api.draftDelay));
      await browserDrafts.current.put(draft);
      api.draftWrites++;
    },
  });
  const storage = useRef<DocumentStorage>({
    async save(input) {
      const api = window.documentStudioTest;
      api.saves++;
      api.expectedVersions.push(input.expectedVersion);
      if (api.mode === "failure") throw new Error("테스트 저장 실패");
      if (api.mode === "conflict") throw new SaveConflictError();
      if (api.mode === "delayed")
        await new Promise((resolve) => setTimeout(resolve, 1000));
      api.saved = Array.from(input.bytes);
      return {
        version:
          api.mode === "invalid-version"
            ? (undefined as unknown as string)
            : (api.fixedSaveVersion ?? `v${api.saves + 1}`),
        ...(api.mode === "warning"
          ? {
              warnings: [
                {
                  code: "sandbox-sync-pending",
                  message:
                    "파일은 저장됐지만 샌드박스 반영을 확인하지 못했습니다: guest timeout",
                },
              ],
            }
          : {}),
      };
    },
  });
  useEffect(() => {
    window.documentStudioTest = {
      agent: createAgentBridge(() => editor.current, {
        createDocument: async (template) => {
          const format = editor.current?.getState().format;
          const engine = engines.find((entry) =>
            entry.formats.some((supported) => supported === format),
          );
          if (!engine?.createDocument) throw new Error("Missing factory");
          return engine.createDocument(template);
        },
      }),
      inspectBytes: (bytes, format) =>
        inspectExport({
          bytes: new Uint8Array(bytes),
          format,
          revision: "fixture",
        }),
      state: () => editor.current?.getState(),
      execute: async (command, options) => {
        if (!editor.current) throw new Error("Missing editor");
        await editor.current.execute(command, options);
      },
      export: async () => {
        if (!editor.current) throw new Error("Missing editor");
        return Array.from((await editor.current.exportDocument()).bytes);
      },
      save: async (options) => {
        if (!editor.current) throw new Error("Missing editor");
        await editor.current.save(options);
      },
      flushAutomationDraft: async () => {
        if (!editor.current) throw new Error("Missing editor");
        await editor.current.flushAutomationDraft();
      },
      acquireInputLock: async () => {
        if (!editor.current) throw new Error("Missing editor");
        inputLocks.current.push(await editor.current.acquireInputLock());
      },
      releaseInputLock: async () => {
        await inputLocks.current.pop()?.();
      },
      flushDraft: async () => {
        if (!editor.current) throw new Error("Missing editor");
        await editor.current.flushDraft();
      },
      closeAfterDraft: async () => {
        if (!editor.current) throw new Error("Missing editor");
        await editor.current.flushDraft();
        setClosed(true);
      },
      load: async (format, name = `sample.${format}`) => {
        const response = await fetch(`/samples/${name}`);
        if (!response.ok) throw new Error("Missing fixture");
        setClosed(false);
        setDocument({
          id: `test:${name}`,
          fileName: name,
          format,
          bytes: new Uint8Array(await response.arrayBuffer()),
          version: "v1",
        });
      },
      loadBytes: (bytes, format) =>
        setDocument({
          id: "invalid",
          fileName: `invalid.${format}`,
          format,
          bytes: new Uint8Array(bytes),
          version: "v1",
        }),
      createTemplate: async (format, template) => {
        const engine = engines.find((engine) =>
          engine.formats.includes(format),
        );
        if (!engine?.createDocument) throw new Error("Missing factory");
        const document = await engine.createDocument(template);
        setClosed(false);
        setDocument(document);
      },
      updateVersion: (version) =>
        setDocument((current) => (current ? { ...current, version } : null)),
      acknowledgeSavedSource: () => {
        const saved = window.documentStudioTest.savedEvent;
        if (!saved) throw new Error("Missing save acknowledgement");
        setDocument((current) =>
          current?.id === saved.documentId
            ? {
                ...current,
                bytes: new Uint8Array(saved.bytes),
                version: saved.version,
              }
            : current,
        );
      },
      replaceSameVersion: () =>
        setDocument((current) =>
          current ? { ...current, bytes: new Uint8Array(current.bytes) } : null,
        ),
      rerender: () => setRender((value) => value + 1),
      setDraftPolicy: (mode) => setDraftPolicy(mode),
      seedDraft: async (
        format,
        name,
        text = "이미 보관한 대상 문서 초안",
        corrupt = false,
        secondary = false,
      ) => {
        const engine = engines.find((engine) =>
          engine.formats.includes(format),
        )!;
        const document = await engine.createDocument!({
          fileName: name,
          blocks: [{ kind: "paragraph", text }],
        });
        await (secondary ? secondaryDrafts.current : browserDrafts.current).put(
          {
            key: draftKey("sdk-tests", `test:${name}`),
            bytes: corrupt ? new Uint8Array([1, 2, 3]) : document.bytes,
            fileName: name,
            format,
            baseVersion: "v1",
            updatedAt: Date.now(),
          },
        );
      },
      storedDraft: async (name, secondary = false) => {
        const draft = await (
          secondary ? secondaryDrafts.current : browserDrafts.current
        ).get(draftKey("sdk-tests", `test:${name}`));
        return draft ? Array.from(draft.bytes) : null;
      },
      draftGetDelay: 0,
      draftGets: 0,
      failDraftReads: false,
      failExports: 0,
      exportAttempts: 0,
      failEngineAcknowledgement: false,
      readOnly: false,
      pauseNextCommand: false,
      failPausedCommand: false,
      commandsStarted: [],
      embedded: false,
      persistAutomation: false,
      failAutomationWrites: false,
      failAutomationReads: false,
      automationNamespace: "sdk-tests",
      automationStore: automationDrafts.current,
      retainSavedSource: false,
      stateEvents: [],
      failSavedCallback: false,
      failCreatedCallback: false,
      creationEnabled: true,
      createdIds: [],
      creationsCompleted: 0,
      pauseNextCreation: false,
      failDraftStorage: false,
      draftsDisabled: false,
      draftDelay: 0,
      draftWrites: 0,
      draftStarts: 0,
      savedEvent: null,
      saved: [],
      mode: "success",
      saves: 0,
      expectedVersions: [],
    };
  }, []);
  return (
    <div
      data-test-host
      data-source-id={document?.id}
      style={
        {
          height: "100dvh",
          boxSizing: "border-box",
          padding: 20,
          background: "#f5f6f7",
          fontFamily: "Arial",
          "--primary": "#3b50a8",
          "--primary-foreground": "#fff",
          "--background": "#fff",
          "--foreground": "#1f2937",
          "--border": "#d1d5db",
          "--muted": "#f1f5f9",
          "--muted-foreground": "#64748b",
        } as React.CSSProperties
      }
    >
      {closed ? (
        <p>편집기 닫힘</p>
      ) : document ? (
        <DocumentEditor
          ref={editor}
          document={document}
          engines={[docxEngine(), rhwpEngine(rhwpOptions)].map((engine) => ({
            ...engine,
            View: FaultInjectionView,
            createDocument: async (template) => {
              const api = window.documentStudioTest;
              if (api.pauseNextCreation) {
                api.pauseNextCreation = false;
                await new Promise<void>((resolve) => {
                  api.releasePausedCreation = resolve;
                });
              }
              try {
                return await engine.createDocument!(template);
              } finally {
                api.creationsCompleted++;
              }
            },
          }))}
          storage={storage.current}
          readOnly={window.documentStudioTest.readOnly}
          appearance={
            window.documentStudioTest.embedded ? "embedded" : "standalone"
          }
          onStateChange={(snapshot) =>
            window.documentStudioTest.stateEvents.push(snapshot)
          }
          draftStore={
            window.documentStudioTest.draftsDisabled || draftPolicy === "off"
              ? false
              : draftPolicy === "secondary"
                ? secondaryDrafts.current
                : drafts.current
          }
          draftNamespace={window.documentStudioTest.automationNamespace}
          automationDraftStore={
            window.documentStudioTest.persistAutomation
              ? automationAdapter.current
              : false
          }
          onSaved={(saved) => {
            if (window.documentStudioTest.retainSavedSource)
              setDocument((current) =>
                current?.id === saved.documentId
                  ? {
                      ...current,
                      bytes: new Uint8Array(saved.bytes),
                      version: saved.version,
                    }
                  : current,
              );
            window.documentStudioTest.savedEvent = {
              ...saved,
              bytes: Array.from(saved.bytes),
            };
            if (window.documentStudioTest.failSavedCallback)
              throw new Error("테스트 파일 목록 갱신 실패");
          }}
          onClose={() => setClosed(true)}
          onCreateDocument={
            window.documentStudioTest.creationEnabled
              ? async (document) => {
                  window.documentStudioTest.createdIds.push(document.id);
                  if (window.documentStudioTest.failCreatedCallback)
                    throw new Error("테스트 새 문서 업로드 실패");
                  // A successful host transition must preserve the source fields before replacing its document.
                  await editor.current?.flushDraft();
                  setDocument(document);
                }
              : undefined
          }
        />
      ) : (
        <p>SDK 테스트 준비</p>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
