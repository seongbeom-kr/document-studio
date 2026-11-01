# Declarative document templates

`@document-studio/template` inspects an unknown DOCX/HWPX file, exposes exact source-bound text targets, validates data-only field bindings and generates a copy. No customer registry, generated script or business-specific form is required.

```ts
const structure = await inspectTemplate({ bytes, format: "docx" });
// Ask the user to select targets and define fields; analysis is a proposal only.
validateTemplateDefinition(definition, structure);
const result = await renderTemplate({ bytes, format: "docx", definition, input });
await verifyTemplateOutput({ source: bytes, output: result.bytes, format: "docx", definition, input });
```

Bindings use `sourceHash` plus opaque `targetId`, with optional UTF-16 `[start,end)` offsets on grapheme boundaries. Field IDs are data keys, not labels. Templates do not require `{{placeholders}}`. Same-looking text has different targets. Existing font runs and non-target archive entries are retained. Simple table rows may repeat; merged, nested or reference-bearing rows are rejected.

The server must own authorization, source/version/revision locking, immutable publication, storage receipts and idempotency. A client-supplied hash is not authorization. An AI must only suggest existing editable target IDs and the user must confirm mappings.

HWP conversion belongs to the host and must produce a preserved HWPX working copy before this API is called. Unsupported objects remain read-only. Native Word/Hancom rendering still requires separate compatibility verification.

`createTemplateSelectionBridge({ documentId, bytes, format, sourceHash, normalizedHash, structureRevision })` binds native engine selections to the exact source. `structureRevision` is a positive integer; `normalizedHash` is the hash of the displayed DOCX/HWPX bytes. `capture(session)` returns `{ documentId, sourceHash, normalizedHash, structureRevision, targetId, start?, end? }`; `highlight(session, selection)` reverses it and `null` clears the highlight. Clicks select a complete paragraph, including an empty cell paragraph; drags select a UTF-16 range on grapheme boundaries. The bridge checks native source addresses and exact paragraph contents, never searches for matching text. Unsupported source locations are rejected; use the structural target list there.

React hosts can use `TemplateAuthoringEditor` from `@document-studio/react` with `document`, `engines`, `sourceHash`, numeric `structureRevision`, controlled `selection`, `onSelection`, and optional `onError`. It reuses the standard viewing options (`initialZoom`, `slots`, `appearance`, `ui`), keeps native editing disabled and uses no document storage or draft store. Initial cursor placement, reverse highlights, zoom and reopen do not emit user selections. Diagnostics go to `onError`; the view shows actionable messages. DOCX maps the native OOXML tree to exact source paths. HWPX maps body/cell positions, converting native Unicode scalar offsets to UTF-16. HWP must be opened as its verified HWPX working copy. Cross-paragraph ranges, nested/unsupported objects, and HWPX table locations following unrecognised controls are deliberately rejected.

Build: `yarn build:template`. The fixed `document-studio-template` CLI accepts only `inspect`/`render` JSON requests; it never loads executable code supplied by a form. `runtime-manifest.json` pins the built bundle and CLI for offline workers. Source edits require a fresh build and consumer checksum update. The package is under development; this working tree does not constitute a published release.
