import type {
  TemplateSelectionEngine,
  SourceAddress,
  SourceSelection,
  TemplateSelection,
  TemplateSelectionIdentity,
} from "./selection-types";
import { inspectInternal } from "./structure";
import { elements, parent, NS, type Element } from "./xml";
import { fail, type TemplateFormat } from "./types";
import { inspectV3Internal } from "./v3/structure";
import { canonicalV3 } from "./v3/contract";
import type { TemplateStructureV3 } from "./v3/types";
import type { TemplateSelectionBridgeV3 } from "./selection-types";
export * from "./selection-types";

function xmlPath(
  node: Element,
): Extract<SourceAddress, { format: "docx" }>["path"] {
  const step = {
    namespace: node.namespaceURI ?? "",
    name: node.localName ?? "",
    index: elements(node.parentNode!)
      .filter(
        (n) =>
          n.namespaceURI === node.namespaceURI &&
          n.localName === node.localName,
      )
      .indexOf(node),
  };
  return node.parentNode?.nodeType === 1
    ? [...xmlPath(node.parentNode as Element), step]
    : [step];
}
const key = (address: SourceAddress) =>
  address.format === "docx"
    ? JSON.stringify([
        address.format,
        address.part,
        address.path.map((p) => [p.namespace, p.name, p.index]),
      ])
    : JSON.stringify([
        address.format,
        address.section,
        address.paragraph,
        address.control,
        address.cell,
        address.cellParagraph,
      ]);

/** Build addresses from the exact HWPX parser structure. Unrecognised controls stop cell mapping. */
function hwpxAddresses(roots: Element[]) {
  const result = new Map<Element, SourceAddress>();
  roots.forEach((root, section) => {
    elements(root)
      .filter((n) => n.namespaceURI === NS.hwpx && n.localName === "p")
      .forEach((p, paragraph) => {
        result.set(p, { format: "hwpx", section, paragraph });
        let control = 0,
          verified = true;
        for (const run of elements(p).filter((n) => n.localName === "run"))
          for (const child of elements(run)) {
            if (child.localName === "secPr") {
              control +=
                1 +
                elements(child).filter((n) => n.localName === "colPr").length;
            } else if (child.localName === "ctrl") {
              for (const ctrl of elements(child)) {
                if (ctrl.localName === "colPr") control++;
                else verified = false;
              }
            } else if (child.localName === "tbl") {
              let cell = 0;
              for (const row of elements(child).filter(
                (n) => n.localName === "tr",
              ))
                for (const tc of elements(row).filter(
                  (n) => n.localName === "tc",
                )) {
                  const subList = elements(tc).find(
                    (n) => n.localName === "subList",
                  );
                  if (verified && subList)
                    elements(subList)
                      .filter((n) => n.localName === "p")
                      .forEach((cp, cellParagraph) =>
                        result.set(cp, {
                          format: "hwpx",
                          section,
                          paragraph,
                          control,
                          cell,
                          cellParagraph,
                        }),
                      );
                  cell++;
                }
              control++;
            } else if (
              !["t", "rPr", "lineBreak"].includes(child.localName ?? "")
            )
              verified = false;
          }
      });
  });
  return result;
}
function range(text: string, start?: number, end?: number) {
  if (start === undefined && end === undefined) return {};
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start! < 0 ||
    end! <= start! ||
    end! > text.length
  )
    fail("TEMPLATE_SELECTION_RANGE");
  const boundaries = new Set([
    0,
    text.length,
    ...Array.from(
      new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
      (s) => s.index,
    ),
  ]);
  if (!boundaries.has(start!) || !boundaries.has(end!))
    fail("TEMPLATE_SELECTION_RANGE");
  return { start, end };
}
export async function createTemplateSelectionBridge(input: {
  documentId: string;
  bytes: Uint8Array;
  format: TemplateFormat;
  structureRevision: number;
  /** For normalized HWP this is the preserved HWP hash; normalizedHash verifies the displayed HWPX. */
  sourceHash?: string;
  normalizedHash?: string;
}) {
  const { structure, opened, nodes } = await inspectInternal(input);
  if (
    !input.documentId ||
    !Number.isSafeInteger(input.structureRevision) ||
    input.structureRevision < 1
  )
    fail("TEMPLATE_SELECTION_IDENTITY");
  if (input.normalizedHash && input.normalizedHash !== structure.sourceHash)
    fail("TEMPLATE_SELECTION_STALE");
  const identity: TemplateSelectionIdentity = Object.freeze({
    documentId: input.documentId,
    sourceHash: input.sourceHash ?? structure.sourceHash,
    normalizedHash: structure.sourceHash,
    structureRevision: input.structureRevision,
  });
  const byAddress = new Map<string, string>(),
    byId = new Map<string, SourceAddress>();
  const hwpx =
    input.format === "hwpx"
      ? hwpxAddresses(
          opened.bodyParts.map((p) => opened.xml.get(p)!.documentElement!),
        )
      : undefined;
  for (const target of structure.targets) {
    const node = nodes.get(target.id)!;
    const address: SourceAddress | undefined =
      input.format === "docx"
        ? { format: "docx", part: target.part, path: xmlPath(node) }
        : hwpx?.get(node);
    if (address && target.editable) {
      byAddress.set(key(address), target.id);
      byId.set(target.id, address);
    }
  }
  const locate = (selection: TemplateSelection): SourceSelection => {
    if (
      (Object.keys(identity) as (keyof TemplateSelectionIdentity)[]).some(
        (k) => selection[k] !== identity[k],
      )
    )
      fail("TEMPLATE_SELECTION_STALE");
    const address = byId.get(selection.targetId),
      target = structure.targets.find((t) => t.id === selection.targetId);
    if (!address || !target) fail("TEMPLATE_SELECTION_UNSUPPORTED");
    return {
      sourceHash: identity.normalizedHash,
      address: structuredClone(address),
      text: target.text,
      ...range(target.text, selection.start, selection.end),
    };
  };
  const resolve = (selection: SourceSelection): TemplateSelection => {
    if (selection.sourceHash !== identity.normalizedHash)
      fail("TEMPLATE_SELECTION_STALE");
    const targetId = byAddress.get(key(selection.address));
    if (!targetId) fail("TEMPLATE_SELECTION_UNSUPPORTED");
    const target = structure.targets.find((t) => t.id === targetId)!;
    if (target.text !== selection.text) fail("TEMPLATE_SELECTION_PROVENANCE");
    return {
      ...identity,
      targetId,
      ...range(target.text, selection.start, selection.end),
    };
  };
  return {
    identity,
    structure,
    resolve,
    locate,
    async capture(session: TemplateSelectionEngine) {
      if (!session.captureSourceSelection || session.getSnapshot().dirty)
        fail("TEMPLATE_SELECTION_UNSUPPORTED");
      return resolve(await session.captureSourceSelection());
    },
    async highlight(
      session: TemplateSelectionEngine,
      selection: TemplateSelection | null,
    ) {
      if (!session.highlightSourceSelection || session.getSnapshot().dirty)
        fail("TEMPLATE_SELECTION_UNSUPPORTED");
      await session.highlightSourceSelection(
        selection ? locate(selection) : null,
      );
    },
  };
}

/** V3 uses the same native, address-based selection coordinates as v2. */
export async function createTemplateSelectionBridgeV3(input: {
  documentId: string;
  bytes: Uint8Array;
  structure: TemplateStructureV3;
}): Promise<TemplateSelectionBridgeV3> {
  const inspected = await inspectV3Internal({
    bytes: input.bytes,
    format: input.structure.format,
    identity: input.structure.identity,
  });
  if (canonicalV3(inspected.structure) !== canonicalV3(input.structure))
    fail("TEMPLATE_SELECTION_STALE");
  const legacy = await createTemplateSelectionBridge({
    documentId: input.documentId,
    bytes: input.bytes,
    format: input.structure.format,
    ...input.structure.identity,
  });
  const toLegacy = new Map<string, string>(),
    toV3 = new Map<string, string>();
  for (const [id, node] of inspected.nodes) {
    if (!inspected.structure.regions.find((r) => r.id === id)?.editable)
      continue;
    const old = [...inspected.legacyNodes].find(([, n]) => n === node)?.[0];
    if (old) {
      toLegacy.set(id, old);
      toV3.set(old, id);
    }
  }
  const resolve = (location: SourceSelection): TemplateSelection => {
    const old = legacy.resolve(location),
      targetId = toV3.get(old.targetId);
    if (!targetId) fail("TEMPLATE_SELECTION_UNSUPPORTED");
    return { ...old, targetId };
  };
  const locate = (selection: TemplateSelection): SourceSelection => {
    const targetId = toLegacy.get(selection.targetId);
    if (!targetId) fail("TEMPLATE_SELECTION_UNSUPPORTED");
    return legacy.locate({ ...selection, targetId });
  };
  return {
    identity: legacy.identity,
    structure: inspected.structure,
    resolve,
    locate,
    async capture(session) {
      if (!session.captureSourceSelection || session.getSnapshot().dirty)
        fail("TEMPLATE_SELECTION_UNSUPPORTED");
      return resolve(await session.captureSourceSelection());
    },
    async highlight(session, selection) {
      if (!session.highlightSourceSelection || session.getSnapshot().dirty)
        fail("TEMPLATE_SELECTION_UNSUPPORTED");
      await session.highlightSourceSelection(
        selection ? locate(selection) : null,
      );
    },
  };
}
