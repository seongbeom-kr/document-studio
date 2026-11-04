import { canonicalV3, digestV3, validateContractV3 } from "./contract";
import { validPlanGridV3 } from "./table-grid";
import type {
  DigestV3,
  RegionDefinitionV3,
  RenderPlanV3,
  SourceIdentityV3,
  TemplateDefinitionV3,
  TemplateRegionV3,
  TemplateStructureV3,
  ValidatedPlanV3,
} from "./types";

export class ReportPlanErrorV3 extends Error {
  constructor(
    public readonly code: string,
    public readonly regionId?: string,
  ) {
    super(code);
    this.name = "ReportPlanErrorV3";
  }
}
function reject(code: string, regionId?: string): never {
  throw new ReportPlanErrorV3(code, regionId);
}
const same = (a: unknown, b: unknown) => canonicalV3(a) === canonicalV3(b);
const unique = (keys: string[], code: string, region?: string) => {
  if (new Set(keys).size !== keys.length) reject(code, region);
};
export async function regionReviewDigestV3(
  region: RegionDefinitionV3,
): Promise<DigestV3> {
  const { reviewState: _state, reviewDigest: _digest, ...reviewed } = region;
  return digestV3(reviewed);
}
function identityMatches(a: SourceIdentityV3, b: SourceIdentityV3) {
  return same(a, b);
}
function sourceStyles(source: TemplateRegionV3) {
  return new Set([
    ...source.styleIds,
    ...(source.table?.styleIds ?? []),
    ...(source.table?.rows.flatMap((r) => r.cells.flatMap((c) => c.styleIds)) ??
      []),
  ]);
}
function boundaries(text: string) {
  let offset = 0;
  const set = new Set([0]);
  for (const char of text) {
    offset += char.length;
    set.add(offset);
  }
  return set;
}
function overlaps(
  a: RegionDefinitionV3,
  b: RegionDefinitionV3,
  sources: Map<string, TemplateRegionV3>,
) {
  const x = sources.get(a.sourceRegionId)!,
    y = sources.get(b.sourceRegionId)!;
  if (x.address.part !== y.address.part) return false;
  if (x.id === y.id) {
    const ar = a.range ?? { start: 0, end: x.text.length },
      br = b.range ?? { start: 0, end: y.text.length };
    return (
      ar.start === br.start ||
      Math.max(ar.start, br.start) < Math.min(ar.end, br.end)
    );
  }
  const prefix = (a: number[], b: number[]) =>
    a.length < b.length && a.every((n, i) => n === b[i]);
  return (
    prefix(x.address.path, y.address.path) ||
    prefix(y.address.path, x.address.path)
  );
}
export interface RenderPlanValidationV3 {
  structure: TemplateStructureV3;
  definition: TemplateDefinitionV3;
  inputDigest: DigestV3;
  sourceSnapshotDigest: DigestV3;
  /** Server-resolved references belonging to sourceSnapshotDigest, never model-issued references. */
  evidenceRefs?: readonly string[];
  plan: RenderPlanV3;
}
export async function validateRenderPlanV3(
  input: RenderPlanValidationV3,
): Promise<ValidatedPlanV3> {
  const { structure, definition, plan } = input;
  validateContractV3("structure", structure);
  validateContractV3("definition", definition);
  validateContractV3("plan", plan);
  if (
    !identityMatches(structure.identity, definition.identity) ||
    !identityMatches(structure.identity, plan.identity)
  )
    reject("REPORT_SOURCE_IDENTITY_MISMATCH");
  if (
    plan.definitionDigest !== (await digestV3(definition)) ||
    plan.inputDigest !== input.inputDigest ||
    plan.sourceSnapshotDigest !== input.sourceSnapshotDigest
  )
    reject("REPORT_PLAN_DIGEST_MISMATCH");
  const allowedFormats =
    structure.format === "docx" ? ["docx"] : ["hwp", "hwpx"];
  if (definition.output.allowedFormats.some((f) => !allowedFormats.includes(f)))
    reject("REPORT_OUTPUT_FORMAT_NOT_ALLOWED");
  unique(
    structure.regions.map((r) => r.id),
    "REPORT_DUPLICATE_REGION",
  );
  unique(
    structure.styles.map((s) => s.id),
    "REPORT_DUPLICATE_KEY",
  );
  unique(
    definition.regions.map((r) => r.id),
    "REPORT_DUPLICATE_REGION",
  );
  unique(
    plan.regions.map((r) => r.regionId),
    "REPORT_DUPLICATE_REGION",
  );
  const sources = new Map(structure.regions.map((r) => [r.id, r])),
    enabled = definition.regions.filter((r) => r.enabled),
    styles = new Set(structure.styles.map((s) => s.id));
  for (const d of enabled) {
    const source = sources.get(d.sourceRegionId);
    if (!source) reject("REPORT_UNKNOWN_REGION", d.id);
    if (!source.editable) reject("REPORT_REGION_PROTECTED", d.id);
    if (
      d.kind !== source.kind &&
      !(
        d.kind === "paragraphRepeat" &&
        source.kind === "text" &&
        source.capabilities.paragraphRepeat
      )
    )
      reject("REPORT_STRUCTURE_CHANGE_NOT_ALLOWED", d.id);
    if (
      d.reviewState !== "confirmed" ||
      d.reviewDigest !== (await regionReviewDigestV3(d))
    )
      reject("REPORT_INTENT_NOT_CONFIRMED", d.id);
    const allowed = sourceStyles(source);
    if (d.styleIds.some((s) => !allowed.has(s) || !styles.has(s)))
      reject("REPORT_STYLE_NOT_ALLOWED", d.id);
    if (d.range) {
      const points = boundaries(source.text);
      if (!points.has(d.range.start) || !points.has(d.range.end))
        reject("REPORT_INVALID_TEXT_RANGE", d.id);
    }
    unique(
      d.columnRoles.map((r) => r.id),
      "REPORT_DUPLICATE_KEY",
      d.id,
    );
    for (const role of d.columnRoles)
      if (
        !source.table ||
        role.prototypeColumn >= source.table.columns.length ||
        !allowed.has(role.styleId) ||
        !styles.has(role.styleId)
      )
        reject("REPORT_COLUMN_ROLE_NOT_ALLOWED", d.id);
    if (
      d.kind === "table" &&
      source.table &&
      ((d.headerRows ?? source.table.headerRows) > source.table.rows.length ||
        (d.prototypeRow ??
          Math.min(source.table.headerRows, source.table.rows.length - 1)) >=
          source.table.rows.length)
    )
      reject("REPORT_INVALID_PROTOTYPE", d.id);
  }
  for (let i = 0; i < enabled.length; i++)
    for (let j = i + 1; j < enabled.length; j++)
      if (overlaps(enabled[i]!, enabled[j]!, sources))
        reject("REPORT_OVERLAPPING_REGIONS", enabled[j]!.id);
  const refs = new Set(input.evidenceRefs ?? []),
    seen = new Set<string>();
  const totalRows = plan.regions.reduce(
    (n, r) =>
      n +
      (r.kind === "table"
        ? r.rows.length
        : r.kind === "paragraphRepeat"
          ? r.items.length
          : 0),
    0,
  );
  const totalCells = plan.regions.reduce(
    (n, r) => n + (r.kind === "table" ? r.rows.length * r.columns.length : 0),
    0,
  );
  if (totalRows > 1000 || totalCells > 64000)
    reject("REPORT_TABLE_BUDGET_EXCEEDED");
  const evidence = (values: string[], region: string) => {
    if (values.some((ref) => !refs.has(ref)))
      reject("REPORT_INVALID_EVIDENCE", region);
    unique(values, "REPORT_INVALID_EVIDENCE", region);
  };
  for (const p of plan.regions) {
    const d = enabled.find((r) => r.id === p.regionId);
    if (!d) reject("REPORT_UNKNOWN_REGION", p.regionId);
    const source = sources.get(d.sourceRegionId)!;
    seen.add(d.id);
    if (d.kind !== p.kind) reject("REPORT_STRUCTURE_CHANGE_NOT_ALLOWED", d.id);
    if (p.kind === "text") {
      evidence(p.evidenceRefs, d.id);
      const original = source.text.slice(
        d.range?.start ?? 0,
        d.range?.end ?? source.text.length,
      );
      if (
        d.intent.fixedText.some(
          (text) => original.includes(text) && !p.text.includes(text),
        )
      )
        reject("REPORT_FIXED_TEXT_CHANGED", d.id);
    } else if (p.kind === "paragraphRepeat") {
      if (
        !d.policy.allowParagraphRepeat ||
        !source.capabilities.paragraphRepeat ||
        p.items.length > d.policy.maxRows
      )
        reject("REPORT_STRUCTURE_CHANGE_NOT_ALLOWED", d.id);
      unique(
        p.items.map((i) => i.key),
        "REPORT_DUPLICATE_KEY",
        d.id,
      );
      p.items.forEach((i) => evidence(i.evidenceRefs, d.id));
      if (
        d.intent.fixedText.some(
          (text) =>
            source.text.includes(text) &&
            !p.items.some((i) => i.text.includes(text)),
        )
      )
        reject("REPORT_FIXED_TEXT_CHANGED", d.id);
    } else {
      const table = source.table;
      if (!table) reject("REPORT_REGION_PROTECTED", d.id);
      if (
        p.rows.length > d.policy.maxRows ||
        p.columns.length > d.policy.maxColumns
      )
        reject("REPORT_TABLE_BUDGET_EXCEEDED", d.id);
      unique(
        p.columns.map((c) => c.key),
        "REPORT_DUPLICATE_KEY",
        d.id,
      );
      unique(
        p.rows.map((r) => r.key),
        "REPORT_DUPLICATE_KEY",
        d.id,
      );
      const roleCounts = new Map<string, number>();
      for (const c of p.columns) {
        const role = d.columnRoles.find((r) => r.id === c.roleId);
        if (!role) reject("REPORT_COLUMN_ROLE_NOT_ALLOWED", d.id);
        roleCounts.set(role.id, (roleCounts.get(role.id) ?? 0) + 1);
        if (!role.repeatable && roleCounts.get(role.id)! > 1)
          reject("REPORT_COLUMN_ROLE_NOT_ALLOWED", d.id);
        if (c.styleId !== role.styleId)
          reject("REPORT_STYLE_NOT_ALLOWED", d.id);
        evidence(c.evidenceRefs ?? [], d.id);
      }
      if (
        (!d.policy.allowRowChanges || !source.capabilities.rowChanges) &&
        p.rows.length !== table.rows.length
      )
        reject("REPORT_STRUCTURE_CHANGE_NOT_ALLOWED", d.id);
      if (
        (!d.policy.allowColumnChanges || !source.capabilities.columnChanges) &&
        (p.columns.length !== table.columns.length ||
          p.columns.some(
            (c, i) =>
              d.columnRoles.find((r) => r.id === c.roleId)!.prototypeColumn !==
              i,
          ))
      )
        reject("REPORT_STRUCTURE_CHANGE_NOT_ALLOWED", d.id);
      const originalMerges = table.rows.flatMap((r) =>
        r.cells
          .filter((c) => c.rowSpan > 1 || c.columnSpan > 1)
          .map((c) => ({
            row: c.row,
            column: c.column,
            rowSpan: c.rowSpan,
            columnSpan: c.columnSpan,
          })),
      );
      if (
        (!d.policy.allowMerges || !source.capabilities.merges) &&
        !same(p.merges, originalMerges)
      )
        reject("REPORT_STRUCTURE_CHANGE_NOT_ALLOWED", d.id);
      const available = Math.min(
        structure.page.width -
          structure.page.marginLeft -
          structure.page.marginRight,
        table.columns.reduce((sum, c) => sum + c.width, 0),
      );
      if (
        p.columns.reduce(
          (sum, c) =>
            sum +
            Math.max(
              d.policy.minColumnWidth,
              d.columnRoles.find((r) => r.id === c.roleId)!.minWidth,
            ),
          0,
        ) > available
      )
        reject("REPORT_TABLE_WIDTH_EXCEEDED", d.id);
      if (!validPlanGridV3(p, d.headerRows ?? table.headerRows))
        reject("REPORT_INVALID_TABLE_GRID", d.id);
      for (const row of p.rows)
        for (const cell of row.cells) evidence(cell.evidenceRefs, d.id);
      if (
        d.intent.fixedText.some(
          (text) =>
            source.text.includes(text) &&
            !p.rows.some((r) => r.cells.some((c) => c.text.includes(text))),
        )
      )
        reject("REPORT_FIXED_TEXT_CHANGED", d.id);
    }
  }
  if (enabled.some((r) => !seen.has(r.id))) reject("REPORT_MISSING_REGION");
  return { plan: structuredClone(plan), planDigest: await digestV3(plan) };
}
