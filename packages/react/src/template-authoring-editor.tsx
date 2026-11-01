import { useEffect, useMemo, useRef, useState } from "react";
import { createTemplateSelectionBridge } from "@document-studio/template";
import type {
  EditorDocument,
  EditorSession,
  TemplateSelection,
} from "@document-studio/core";
import { DocumentEditor, type DocumentEditorProps } from "./document-editor";
import type { EngineDefinition, EngineViewProps } from "./types";
import { createTemplateAuthoringSession } from "./template-authoring-session";

export interface TemplateAuthoringEditorProps
  extends Pick<
    DocumentEditorProps,
    "initialZoom" | "slots" | "appearance" | "ui" | "onStateChange"
  > {
  document: EditorDocument;
  engines: readonly EngineDefinition[];
  sourceHash: string;
  normalizedHash?: string;
  structureRevision: number;
  selection?: TemplateSelection | null;
  onSelection(selection: TemplateSelection): void;
  onError?(error: Error): void;
}
/** Native document view for immutable template authoring. No storage, draft, save or edit lease. */
export function TemplateAuthoringEditor(props: TemplateAuthoringEditorProps) {
  const latest = useRef(props);
  latest.current = props;
  const [bridge, setBridge] = useState<Awaited<
    ReturnType<typeof createTemplateSelectionBridge>
  > | null>(null);
  const [error, setError] = useState("");
  const session = useRef<EditorSession | null>(null),
    generation = useRef(0),
    unsubscribe = useRef<(() => void) | null>(null);
  const coordinator = useRef<ReturnType<
    typeof createTemplateAuthoringSession<TemplateSelection>
  > | null>(null);
  const report = (cause: unknown) => {
    const failure = cause instanceof Error ? cause : new Error(String(cause));
    const message = failure.message.includes("STALE")
      ? "원본 버전이 바뀌었습니다. 양식을 다시 열어 위치를 선택해 주세요."
      : failure.message.includes("SINGLE_PARAGRAPH")
        ? "한 문단이나 한 셀 안에서 글자를 선택해 주세요."
        : failure.message.includes("RANGE")
          ? "글자 전체가 포함되도록 선택 범위를 다시 지정해 주세요."
          : "이 위치는 문서에서 직접 연결할 수 없습니다. 정확한 위치 목록에서 선택해 주세요.";
    setError(message);
    latest.current.onError?.(failure);
  };
  useEffect(() => {
    let active = true;
    const token = ++generation.current;
    setBridge(null);
    setError("");
    session.current = null;
    coordinator.current?.dispose();
    coordinator.current = null;
    unsubscribe.current?.();
    unsubscribe.current = null;
    if (props.document.format === "hwp") {
      report(new Error("HWP 원본을 보존한 HWPX 작성 사본을 열어 주세요."));
      return;
    }
    void createTemplateSelectionBridge({
      documentId: props.document.id,
      bytes: props.document.bytes,
      format: props.document.format,
      sourceHash: props.sourceHash,
      normalizedHash: props.normalizedHash ?? props.sourceHash,
      structureRevision: props.structureRevision,
    }).then(
      (value) => {
        if (active && token === generation.current) setBridge(value);
      },
      (cause) => {
        if (active) report(cause);
      },
    );
    return () => {
      active = false;
      generation.current++;
      coordinator.current?.dispose();
      unsubscribe.current?.();
      session.current = null;
    };
  }, [
    props.document,
    props.sourceHash,
    props.normalizedHash,
    props.structureRevision,
  ]);
  const wrappedEngines = useMemo(
    () =>
      props.engines.map((engine) => {
        const Native = engine.View;
        function View(viewProps: EngineViewProps) {
          return (
            <Native
              {...viewProps}
              readOnly
              onError={(error) => {
                viewProps.onError(error);
                latest.current.onError?.(error);
              }}
              onReady={(value) => {
                viewProps.onReady(value);
                session.current = value;
                unsubscribe.current?.();
                coordinator.current?.dispose();
                if (bridge)
                  coordinator.current = createTemplateAuthoringSession({
                    capture: () => bridge.capture(value),
                    highlight: (selection) =>
                      bridge.highlight(value, selection),
                    onSelection: (selection) => {
                      setError("");
                      latest.current.onSelection(selection);
                    },
                    onError: report,
                  });
                // Selection notifications do not imply a user gesture (initial caret, layout, zoom).
                unsubscribe.current = value.subscribe(() => {
                  if (value.getSnapshot().dirty)
                    report(new Error("TEMPLATE_SELECTION_READ_ONLY_REQUIRED"));
                });
                if (latest.current.selection)
                  void coordinator.current?.highlight(latest.current.selection);
              }}
              onSourceSelection={(error) => {
                if (error) report(error);
                else void coordinator.current?.capture();
              }}
            />
          );
        }
        return { ...engine, View };
      }),
    [props.engines, bridge],
  );
  useEffect(() => {
    const current = session.current;
    if (!bridge || !current) return;
    setError("");
    void coordinator.current?.highlight(props.selection ?? null);
  }, [bridge, props.selection]);
  return (
    <div
      className="ds-template-authoring"
      style={{
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {error && <p role="status">{error}</p>}
      {bridge ? (
        <DocumentEditor
          document={props.document}
          engines={wrappedEngines}
          readOnly
          draftStore={false}
          automationDraftStore={false}
          initialZoom={props.initialZoom ?? "width"}
          appearance={props.appearance ?? "embedded"}
          slots={props.slots}
          ui={props.ui}
          onStateChange={props.onStateChange}
        />
      ) : (
        !error && <p role="status">양식의 원본 위치를 확인하고 있습니다.</p>
      )}
    </div>
  );
}
