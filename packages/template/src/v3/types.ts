export type DigestV3 = `sha256:${string}`;
export type OutputFormatV3 = "hwp" | "hwpx" | "docx";
export type RegionKindV3 = "text" | "table" | "paragraphRepeat";
export interface SourceIdentityV3 {
  sourceHash: DigestV3;
  normalizedHash: DigestV3;
  structureRevision: number;
}
export interface SourceAddressV3 {
  part: string;
  path: number[];
}
export interface RegionCapabilitiesV3 {
  rowChanges: boolean;
  columnChanges: boolean;
  merges: boolean;
  paragraphRepeat: boolean;
}
/** All page dimensions and widths use integer twips. */
export interface PageBaselineV3 {
  width: number;
  height: number;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  orientation: "portrait" | "landscape";
}
export interface TemplateStyleV3 {
  id: string;
  kind: "paragraph" | "run" | "cell" | "table" | "section";
  digest: DigestV3;
  properties: Record<string, string>;
  label?: string;
}
export interface SourceCellV3 {
  id: string;
  address: SourceAddressV3;
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
  text: string;
  styleIds: string[];
}
export interface SourceRowV3 {
  id: string;
  cells: SourceCellV3[];
}
export interface SourceTableV3 {
  rows: SourceRowV3[];
  columns: { key: string; width: number }[];
  headerRows: number;
  styleIds: string[];
}
export interface TemplateRegionV3 {
  id: string;
  kind: RegionKindV3;
  address: SourceAddressV3;
  text: string;
  styleIds: string[];
  editable: boolean;
  capabilities: RegionCapabilitiesV3;
  reason?: string;
  table?: SourceTableV3;
  parentId?: string;
  textRuns?: { start: number; end: number; styleId: string }[];
}
export interface TemplateStructureV3 {
  schemaVersion: 3;
  identity: SourceIdentityV3;
  format: "docx" | "hwpx";
  regions: TemplateRegionV3[];
  styles: TemplateStyleV3[];
  page: PageBaselineV3;
  protectedParts: Record<string, DigestV3>;
  warnings: string[];
}
export interface WritingIntentV3 {
  purpose: string;
  sources: string[];
  include: string[];
  exclude: string[];
  tone: string;
  instructions: string;
  fixedText: string[];
}
export interface RegionPolicyV3 {
  allowRowChanges: boolean;
  allowColumnChanges: boolean;
  allowMerges: boolean;
  allowParagraphRepeat: boolean;
  maxRows: number;
  maxColumns: number;
  minColumnWidth: number;
  empty: "remove" | "keep" | "blank";
}
export interface ColumnRoleV3 {
  id: string;
  label: string;
  prototypeColumn: number;
  styleId: string;
  minWidth: number;
  repeatable: boolean;
}
export interface RegionDefinitionV3 {
  id: string;
  sourceRegionId: string;
  kind: RegionKindV3;
  enabled: boolean;
  intent: WritingIntentV3;
  reviewState: "unreviewed" | "confirmed" | "needs-review";
  reviewDigest: DigestV3 | null;
  styleIds: string[];
  policy: RegionPolicyV3;
  columnRoles: ColumnRoleV3[];
  headerRows?: number;
  prototypeRow?: number;
  inputKey?: string;
  fieldProvenance?: Record<string, "ai" | "user">;
  range?: { start: number; end: number };
}
export interface TemplateDefinitionV3 {
  schemaVersion: 3;
  identity: SourceIdentityV3;
  regions: RegionDefinitionV3[];
  inputSchema: Record<string, unknown>;
  output: {
    defaultFormat: OutputFormatV3;
    allowedFormats: OutputFormatV3[];
    fileName?: string;
  };
  policy: {
    pageSize: "preserve";
    orientation: "preserve";
    fontSize: "preserve";
  };
}
export interface TextPlanV3 {
  regionId: string;
  kind: "text";
  text: string;
  evidenceRefs: string[];
}
export interface ColumnPlanV3 {
  key: string;
  roleId: string;
  dataKey: string;
  styleId: string;
  widthWeight: number;
  label?: string;
  evidenceRefs?: string[];
}
export interface CellPlanV3 {
  columnKey: string;
  text: string;
  evidenceRefs: string[];
}
export interface RowPlanV3 {
  key: string;
  groupKey: string;
  cells: CellPlanV3[];
}
export interface MergeV3 {
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
}
export interface TablePlanV3 {
  regionId: string;
  kind: "table";
  columns: ColumnPlanV3[];
  rows: RowPlanV3[];
  merges: MergeV3[];
}
export interface ParagraphPlanV3 {
  regionId: string;
  kind: "paragraphRepeat";
  items: { key: string; text: string; evidenceRefs: string[] }[];
}
export type RegionPlanV3 = TextPlanV3 | TablePlanV3 | ParagraphPlanV3;
export interface RenderPlanV3 {
  schemaVersion: 3;
  identity: SourceIdentityV3;
  definitionDigest: DigestV3;
  inputDigest: DigestV3;
  sourceSnapshotDigest: DigestV3;
  regions: RegionPlanV3[];
}
export interface ValidatedPlanV3 {
  plan: RenderPlanV3;
  planDigest: DigestV3;
}
export interface ArtifactV3 {
  operationId: string;
  outputFormat: OutputFormatV3;
  path: string;
  digest: DigestV3;
  byteLength: number;
  verificationDigest: DigestV3;
}
export interface LocalReceiptV3 extends ArtifactV3 {
  finalVerified: boolean;
}
export interface RegistrationV3 extends ArtifactV3 {
  scope: "server-workspace";
  confirmed: boolean;
}
export interface ReportErrorV3 {
  code: string;
  message: string;
  retryable: boolean;
  field?: string;
  regionId?: string;
  requiredAction?: string;
  effect?: string;
  retryOf?: string;
}
export interface ReportResultV3 {
  resultContractVersion: 3;
  operationId?: string;
  skillId: string;
  version: string;
  payloadDigest: DigestV3;
  ok: boolean;
  generated: boolean | null;
  serverStored: boolean;
  completion: "pending" | "completed" | "failed" | "uncertain";
  artifact?: ArtifactV3;
  localReceipt?: LocalReceiptV3;
  registration?: RegistrationV3;
  error?: ReportErrorV3;
}
export interface RuntimeProfileV3 {
  parser: string;
  renderer: string;
  exporter: string;
  verifier: string;
  fontPackDigest: DigestV3;
  schemaDigest: DigestV3;
}
export interface WorkingDocumentProofV3 {
  sourceIdentity: SourceIdentityV3;
  planDigest: DigestV3;
  outputDigest: DigestV3;
  protectedPartDigests: Record<string, DigestV3>;
  gridValid: true;
  stylesPreserved: true;
  runtimeProfile: RuntimeProfileV3;
}
export interface FinalDocumentProofV3 {
  sourceIdentity: SourceIdentityV3;
  planDigest: DigestV3;
  workingDigest: DigestV3;
  outputDigest: DigestV3;
  outputFormat: OutputFormatV3;
  contentLoss: { count: 0; losses: unknown[] };
  pageCountBefore: number;
  pageCountAfter: number;
  gridPreserved: true;
  protectedStylesPreserved: true;
  runtimeProfile: RuntimeProfileV3;
  pageLayoutDigestBefore: DigestV3;
  pageLayoutDigestAfter: DigestV3;
  fontBindings: {
    charShapeId: number;
    languageIndex: number;
    requestedFamily: string;
    resolvedFamily: string;
    fontDigest: string;
  }[];
  previewDigests: DigestV3[];
  layoutRuntime: string;
}
export interface PagePreviewV3 {
  page: number;
  width: number;
  height: number;
  digest: DigestV3;
  svg: string;
}
export interface FinalDocumentV3 {
  bytes: Uint8Array;
  outputFormat: OutputFormatV3;
  digest: DigestV3;
  byteLength: number;
  verificationDigest: DigestV3;
  proof: FinalDocumentProofV3;
  previews: PagePreviewV3[];
}
export const V3_LIMITS = Object.freeze({
  sourceBytes: 32 * 1024 * 1024,
  outputBytes: 64 * 1024 * 1024,
  xmlPartBytes: 8 * 1024 * 1024,
  xmlBytes: 64 * 1024 * 1024,
  rows: 1000,
  columns: 64,
  cells: 64000,
});
