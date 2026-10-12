import type { EditorDocument } from "@document-studio/core";

export interface SavedSource {
  documentId: string;
  format: EditorDocument["format"];
  version: string;
  sessionId: string;
  scope: string;
  bytes: Uint8Array;
}

export function matchesSavedSource(
  saved: SavedSource | null,
  source: EditorDocument,
  sessionId: string,
  scope: string,
): boolean {
  if (
    !saved ||
    saved.documentId !== source.id ||
    saved.format !== source.format ||
    saved.version !== source.version ||
    saved.sessionId !== sessionId ||
    saved.scope !== scope ||
    saved.bytes.length !== source.bytes.length
  )
    return false;
  return saved.bytes.every((byte, index) => byte === source.bytes[index]);
}
