import { zipSync } from "fflate";
import {
  attr,
  elements,
  openArchive,
  serialize,
  walk,
  NS,
  type Element,
} from "../xml";
import { checkNativeBoundsV3 } from "./native-layout-bounds";
import type { NativeHwpDocumentV3 } from "./native-runtime";

type Value = Record<string, any>;
type Box = { x: number; y: number; w: number; h: number };
const invalid = (): never => {
  throw new Error("REPORT_LAYOUT_INVALID");
};
const overflow = (): never => {
  throw new Error("REPORT_LAYOUT_OVERFLOW");
};
const object = (value: unknown): Value =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Value)
    : invalid();
const integer = (value: unknown, max = 1000000): number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= max
    ? value
    : invalid();
type LayoutDocument = Pick<
  NativeHwpDocumentV3,
  | "pageCount"
  | "getPageInfo"
  | "getPageTextLayout"
  | "getPageRenderTree"
  | "getTableDimensions"
  | "getCellInfo"
  | "getCellProperties"
  | "resizeTableCells"
  | "reflowLinesegs"
>;
type Growth = {
  section: number;
  paragraph: number;
  control: number;
  row: number;
  column: number;
  pixels: number;
};

/** Native text wrapping can outgrow a stored row height. Only measured vertical text
 * overflow in body tables may grow; widths, fonts, grid, images and page settings stay fixed. */
export async function fitNativeTableRowsV3(
  document: LayoutDocument,
): Promise<boolean> {
  let changed = false;
  for (let attempt = 0; attempt <= 4; attempt++) {
    const count = integer(document.pageCount(), 200);
    if (!count) invalid();
    const growth: Growth[] = [];
    let failed = false;
    for (let page = 0; page < count; page++) {
      const info = object(JSON.parse(document.getPageInfo(page)));
      const tree = object(JSON.parse(document.getPageRenderTree(page)));
      const text = JSON.parse(document.getPageTextLayout(page));
      try {
        checkNativeBoundsV3(tree, info.width, info.height, text);
        continue;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== "REPORT_LAYOUT_OVERFLOW"
        )
          throw error;
      }
      failed = true;
      const section = integer(info.sectionIndex, 199);
      function visit(
        node: Value,
        body = false,
        table?: { paragraph: number; control: number; depth: number },
        cell?: { box: Box; row: number; column: number },
      ) {
        body ||= node.type === "Body";
        if (node.type === "Table")
          table = {
            paragraph: integer(node.pi),
            control: integer(node.ci),
            depth: (table?.depth ?? 0) + 1,
          };
        if ((node.type === "Cell" || node.type === "TableCell") && node.bbox)
          cell = {
            box: node.bbox,
            row: integer(node.row, 999),
            column: integer(node.col, 63),
          };
        const box = node.bbox as Box | undefined;
        if (
          node.type === "TextRun" &&
          box &&
          cell &&
          box.y + box.h > cell.box.y + cell.box.h + 0.75
        ) {
          const leaf = { type: "Cell", bbox: cell.box, children: [node] };
          let clipped = false;
          try {
            checkNativeBoundsV3(leaf, info.width, info.height, text);
          } catch (error) {
            if (
              !(error instanceof Error) ||
              error.message !== "REPORT_LAYOUT_OVERFLOW"
            )
              throw error;
            clipped = true;
          }
          if (clipped) {
            if (!body || !table || table.depth !== 1) return overflow();
            const bottom = box.y + box.h;
            // The same strict character-aware checker must accept everything except
            // the measured lower bound; horizontal/top clipping is never resized away.
            checkNativeBoundsV3(
              { ...leaf, bbox: { ...cell.box, h: bottom - cell.box.y + 1 } },
              info.width,
              Math.max(info.height, bottom + 1),
              text,
            );
            growth.push({
              section,
              paragraph: table.paragraph,
              control: table.control,
              row: cell.row,
              column: cell.column,
              pixels: bottom - cell.box.y - cell.box.h,
            });
          }
        }
        if (Array.isArray(node.children))
          for (const child of node.children)
            visit(object(child), body, table, cell);
      }
      visit(tree);
    }
    if (!failed) return changed;
    if (
      attempt === 4 ||
      !growth.length ||
      !document.getTableDimensions ||
      !document.getCellInfo ||
      !document.getCellProperties ||
      !document.resizeTableCells
    )
      overflow();
    const groups = new Map<string, Growth[]>();
    for (const item of growth) {
      const key = JSON.stringify([item.section, item.paragraph, item.control]);
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    for (const items of groups.values()) {
      const first = items[0]!,
        address = [first.section, first.paragraph, first.control] as const;
      const dimensions = object(
        JSON.parse(document.getTableDimensions!(...address)),
      );
      const cells = integer(dimensions.cellCount, 64000);
      if (
        !cells ||
        !integer(dimensions.rowCount, 1000) ||
        !integer(dimensions.colCount, 64)
      )
        invalid();
      const indices = new Map<string, number>();
      for (let index = 0; index < cells; index++) {
        const info = object(
          JSON.parse(document.getCellInfo!(...address, index)),
        );
        const key = JSON.stringify([
          integer(info.row, 999),
          integer(info.col, 63),
        ]);
        if (indices.has(key)) invalid();
        indices.set(key, index);
      }
      const deltas = new Map<number, number>();
      for (const item of items) {
        const index = indices.get(JSON.stringify([item.row, item.column]));
        if (index === undefined) invalid();
        const props = object(
          JSON.parse(document.getCellProperties!(...address, index!)),
        );
        const alignment = integer(props.verticalAlign, 2);
        // Centered native text moves down as its row grows. Compensate for that
        // movement, retain a one-pixel guard, and require convergence on remeasure.
        const delta = Math.ceil((item.pixels + 1) * (alignment ? 2 : 1) * 75);
        if (!Number.isSafeInteger(delta) || delta <= 0 || delta > 16000000)
          invalid();
        deltas.set(index!, Math.max(deltas.get(index!) ?? 0, delta));
      }
      const changes = JSON.stringify(
        [...deltas].map(([cellIdx, heightDelta]) => ({ cellIdx, heightDelta })),
      );
      const result = object(
        JSON.parse(document.resizeTableCells!(...address, changes)),
      );
      if (result.ok !== true) invalid();
    }
    document.reflowLinesegs();
    changed = true;
  }
  return overflow();
}

/** Retain original HWPX package parts. Copy only the exact native height deltas,
 * never use a regenerated package as a substitute for protected original parts. */
export async function patchNativeRowHeightsV3(
  original: Uint8Array,
  nativeBefore: Uint8Array,
  nativeAfter: Uint8Array,
): Promise<Uint8Array> {
  const source = openArchive(original, "hwpx"),
    before = openArchive(nativeBefore, "hwpx"),
    after = openArchive(nativeAfter, "hwpx");
  const fail = (): never => {
    throw new Error("REPORT_HWP_STRUCTURE_MISMATCH");
  };
  if (
    source.bodyParts.length !== before.bodyParts.length ||
    source.bodyParts.length !== after.bodyParts.length
  )
    fail();
  const direct = (node: Element, name: string) =>
    elements(node).find(
      (n) => n.namespaceURI === NS.hwpx && n.localName === name,
    );
  const same = (nodes: Element[], name: string) => {
    if (!nodes.every((n) => attr(n, name) === attr(nodes[0]!, name))) fail();
  };
  const height = (
    sourceNode: Element | undefined,
    old: Element | undefined,
    next: Element | undefined,
  ) => {
    if (!sourceNode || !old || !next) return fail();
    same([sourceNode, old, next], "width");
    if (attr(old, "height") === attr(next, "height")) return false;
    if (
      attr(sourceNode, "height") !== attr(old, "height") ||
      !/^[1-9]\d*$/.test(attr(next, "height") ?? "") ||
      Number(attr(next, "height")) > 2147483647 ||
      Number(attr(next, "height")) < Number(attr(old, "height"))
    )
      fail();
    sourceNode.setAttribute("height", attr(next, "height")!);
    return true;
  };
  for (const part of source.bodyParts) {
    const documents = [source, before, after].map(
      (a) => a.xml.get(part) ?? fail(),
    );
    const tables = documents.map((doc) =>
      walk(doc).filter(
        (n) => n.namespaceURI === NS.hwpx && n.localName === "tbl",
      ),
    );
    if (tables.some((t) => t.length !== tables[0]!.length)) fail();
    let changed = false;
    for (let index = 0; index < tables[0]!.length; index++) {
      const current = tables.map((t) => t[index]!);
      same(current, "rowCnt");
      same(current, "colCnt");
      changed =
        height(
          ...(current.map((t) => direct(t, "sz")) as [
            Element,
            Element,
            Element,
          ]),
        ) || changed;
      const cells = current.map((t) =>
        walk(t).filter(
          (n) => n.namespaceURI === NS.hwpx && n.localName === "tc",
        ),
      );
      if (cells.some((c) => c.length !== cells[0]!.length)) fail();
      for (let ci = 0; ci < cells[0]!.length; ci++) {
        const nodes = cells.map((c) => c[ci]!);
        for (const [name, fields] of [
          ["cellAddr", ["rowAddr", "colAddr"]],
          ["cellSpan", ["rowSpan", "colSpan"]],
        ] as const) {
          const props = nodes.map((n) => direct(n, name) ?? fail());
          for (const field of fields) same(props, field);
        }
        changed =
          height(
            ...(nodes.map((n) => direct(n, "cellSz")) as [
              Element,
              Element,
              Element,
            ]),
          ) || changed;
      }
    }
    if (changed) source.parts[part] = serialize(documents[0]!);
  }
  const bytes = zipSync(
    Object.fromEntries(
      Object.entries(source.parts).map(([name, data]) => [
        name,
        [data, { mtime: new Date(2000, 0, 1) }],
      ]),
    ),
    { level: 6 },
  );
  if (bytes.length > 64 * 1024 * 1024) throw new Error("REPORT_OUTPUT_LIMIT");
  return bytes;
}
