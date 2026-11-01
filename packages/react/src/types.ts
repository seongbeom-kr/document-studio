import type { ComponentType } from "react";
import type {
  DocumentFormat,
  EditorDocument,
  EditorSession,
  DocumentTemplate,
  EngineInitializationPhase,
} from "@document-studio/core";
export interface EngineViewProps {
  /** Freeze all interaction during modal dialogs and serialization/host transitions. */
  inputBlocked?: boolean;
  /** Native edit permission; selection remains available. Session must expose setReadOnly. */
  readOnly?: boolean;
  /** Explicit user gesture in a read-only authoring view (also fires for an empty paragraph). */
  onSourceSelection?(error?: Error): void;
  document: EditorDocument;
  onReady(session: EditorSession): void;
  onError(error: Error): void;
  onInitializationPhase?(phase: EngineInitializationPhase): void;
  onInitializationDiagnostics?(
    diagnostics: import("@document-studio/core").EngineInitializationDiagnostics,
  ): void;
  onSaveRequest(): void;
  onFindRequest?(): void;
  advancedTools?: boolean;
}
export interface EngineDefinition {
  id: string;
  formats: readonly DocumentFormat[];
  View: ComponentType<EngineViewProps>;
  createDocument?(template: DocumentTemplate): Promise<EditorDocument>;
  /** Optional engine-specific isolated pre-parse, including the common archive validation. */
  validateDocument?(
    document: EditorDocument,
    signal: AbortSignal,
  ): Promise<void>;
}
