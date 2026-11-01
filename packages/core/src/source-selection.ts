/** Source coordinates only. Never a screen rectangle or a text-search anchor. */
export type SourceAddress =
  | {
      format: "docx";
      part: string;
      path: { namespace: string; name: string; index: number }[];
    }
  | {
      format: "hwpx";
      section: number;
      paragraph: number;
      control?: number;
      cell?: number;
      cellParagraph?: number;
    };
export interface SourceSelection {
  sourceHash: string;
  address: SourceAddress;
  /** Full paragraph text verifies the engine's projection; it never locates a target. */
  text: string;
  /** UTF-16, half open. Omitted means the whole paragraph, including an empty one. */
  start?: number;
  end?: number;
}
export interface TemplateSelectionIdentity {
  documentId: string;
  sourceHash: string;
  normalizedHash: string;
  structureRevision: number;
}
export interface TemplateSelection extends TemplateSelectionIdentity {
  targetId: string;
  start?: number;
  end?: number;
}
export async function sourceBytesHash(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(bytes).buffer,
  );
  return (
    "sha256:" +
    Array.from(new Uint8Array(hash), (n) =>
      n.toString(16).padStart(2, "0"),
    ).join("")
  );
}
