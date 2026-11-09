import { sourceNodeV3 } from "./structure";
import type { Document, Element } from "../xml";
import { allocateColumnWidthsV3 } from "./table-grid";
import type {
  RegionDefinitionV3,
  TemplateRegionV3,
  TemplateStructureV3,
  TablePlanV3,
  SourceCellV3,
} from "./types";
export function tableLayoutV3(
  plan: TablePlanV3,
  definition: RegionDefinitionV3,
  source: TemplateRegionV3,
  structure: TemplateStructureV3,
) {
  const table = source.table!,
    headerRows = definition.headerRows ?? table.headerRows;
  const total = Math.min(
    structure.page.width -
      structure.page.marginLeft -
      structure.page.marginRight,
    table.columns.reduce((n, c) => n + c.width, 0),
  );
  const widths = allocateColumnWidthsV3(
    total,
    plan.columns.map((c) =>
      Math.max(
        definition.policy.minColumnWidth,
        definition.columnRoles.find((r) => r.id === c.roleId)!.minWidth,
      ),
    ),
    plan.columns.map((c) => c.widthWeight),
  );
  if (plan.rows.length) return { plan, widths, headerRows };
  const count =
    definition.policy.empty === "remove"
      ? 0
      : definition.policy.empty === "keep"
        ? table.rows.length
        : 1;
  return {
    plan: {
      ...plan,
      merges: [],
      rows: Array.from({ length: count }, (_, r) => ({
        key: `empty_${r}`,
        groupKey: "",
        cells: plan.columns.map((c) => ({
          columnKey: c.key,
          text: "",
          evidenceRefs: [],
        })),
      })),
    },
    widths,
    headerRows: Math.min(headerRows, count),
  };
}
export function prototypeCellV3(
  source: TemplateRegionV3,
  definition: RegionDefinitionV3,
  row: number,
  column: number,
  plan: TablePlanV3,
): SourceCellV3 {
  const table = source.table!,
    role = definition.columnRoles.find(
      (r) => r.id === plan.columns[column]!.roleId,
    )!;
  const prototype =
    row < (definition.headerRows ?? table.headerRows)
      ? row
      : (definition.prototypeRow ??
        Math.min(table.headerRows, table.rows.length - 1));
  const cell = table.rows
    .flatMap((r) => r.cells)
    .find(
      (c) =>
        c.row <= prototype &&
        c.row + c.rowSpan > prototype &&
        c.column <= role.prototypeColumn &&
        c.column + c.columnSpan > role.prototypeColumn,
    );
  if (!cell) throw new Error("REPORT_INVALID_PROTOTYPE");
  return cell;
}
export function prototypeNodeV3(
  doc: Document,
  source: TemplateRegionV3,
  definition: RegionDefinitionV3,
  row: number,
  column: number,
  plan: TablePlanV3,
): Element {
  return sourceNodeV3(
    doc,
    prototypeCellV3(source, definition, row, column, plan).address,
  );
}
