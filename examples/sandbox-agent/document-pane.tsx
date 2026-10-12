"use client";
import { forwardRef, useCallback, useEffect, useMemo, useRef } from "react";
import type { EditorDocument } from "@document-studio/core";
import {
  DocumentEditor,
  createAgentBridge,
  type DocumentEditorHandle,
  type DocumentEditorProps,
} from "@document-studio/react";
import { docxEngine } from "@document-studio/engine-docx";
import { rhwpEngine } from "@document-studio/engine-rhwp";
import { createSandboxStorage, type SandboxHost } from "./storage";
import "@document-studio/react/styles.css";

export type DocumentAgent = ReturnType<typeof createAgentBridge>;
export interface SandboxDocumentPaneProps {
  document: EditorDocument;
  host: SandboxHost;
  studioUrl: string;
  draftNamespace: string;
  onDirtyChange?: DocumentEditorProps["onDirtyChange"];
  onStateChange?: DocumentEditorProps["onStateChange"];
  readOnly?: boolean;
  onSaved?: DocumentEditorProps["onSaved"];
  onClose?: DocumentEditorProps["onClose"];
  onAgentChange?(agent: DocumentAgent | null): void;
}

/** Consumer-owned adapter: embed this pane in the existing file tab/modal, without adding routes or a file manager. */
export const SandboxDocumentPane = forwardRef<
  DocumentEditorHandle,
  SandboxDocumentPaneProps
>(function SandboxDocumentPane(
  {
    document,
    host,
    studioUrl,
    draftNamespace,
    onDirtyChange,
    onStateChange,
    readOnly,
    onSaved,
    onClose,
    onAgentChange,
  },
  ref,
) {
  const editor = useRef<DocumentEditorHandle>(null);
  const engines = useMemo(
    () => [docxEngine(), rhwpEngine({ studioUrl })],
    [studioUrl],
  );
  const storage = useMemo(() => createSandboxStorage(host), [host]);
  const agent = useMemo(() => createAgentBridge(() => editor.current), []);
  const attachEditor = useCallback(
    (handle: DocumentEditorHandle | null) => {
      editor.current = handle;
      if (typeof ref === "function") ref(handle);
      else if (ref) ref.current = handle;
    },
    [ref],
  );
  useEffect(() => {
    onAgentChange?.(agent);
    return () => onAgentChange?.(null);
  }, [agent, onAgentChange]);
  return (
    <DocumentEditor
      ref={attachEditor}
      document={document}
      engines={engines}
      appearance="embedded"
      onStateChange={onStateChange}
      readOnly={readOnly}
      storage={storage}
      draftNamespace={draftNamespace}
      onDirtyChange={onDirtyChange}
      onSaved={onSaved}
      onClose={onClose}
    />
  );
});
