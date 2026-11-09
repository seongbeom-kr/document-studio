/** Portable authoring contract. Kept structural so Node workers need no editor packages. */
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
  text: string;
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
export interface TemplateSelectionEngine {
  captureSourceSelection?(): Promise<SourceSelection>;
  highlightSourceSelection?(selection: SourceSelection | null): Promise<void>;
  getSnapshot(): { dirty: boolean };
}
export interface TemplateSelectionBridgeV3 {
  identity: TemplateSelectionIdentity;
  structure: import("./v3/types").TemplateStructureV3;
  locate(selection: TemplateSelection): SourceSelection;
  resolve(location: SourceSelection): TemplateSelection;
  capture(session: TemplateSelectionEngine): Promise<TemplateSelection>;
  highlight(
    session: TemplateSelectionEngine,
    selection: TemplateSelection | null,
  ): Promise<void>;
}
