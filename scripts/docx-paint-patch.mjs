import { createHash } from "node:crypto";

export const DOCX_PAINT_PATCH = Object.freeze({
  engineVersion: "2.25.0",
  sourceCommit: "ff8242b025c8487c2309027ac65d7e51a14be7f4",
  sourceFile: "packages/core/src/output/semantic-paint.ts",
  inputSha256:
    "2115a8352f22fff1d4e6f385f1c4ed658855d82b073862af4509d4655316bec9",
  change:
    "Use the first inline atom as the paint origin and include drawing advances in the shaped-text cursor. Layout geometry and OOXML remain unchanged.",
});

// Apache-2.0 upstream source. Its paintLine adds the drawing spacer to DOM flow,
// but omits that advance from logicalAdvance before positioning shaped spans.
// Bundle this checked modification in the SDK; consumers need no package patch.
export function patchDocxPaint(code) {
  const hash = createHash("sha256").update(code).digest("hex");
  if (hash !== DOCX_PAINT_PATCH.inputSha256)
    throw new Error(
      "DOCX paint source changed; review the pinned patch before building.",
    );
  const before = "r.append(R),x+=1,d=null,c=null;";
  const origin =
    'function yn(t,e,o,n=false){let i=o.scale,r=t.createElement("div");';
  const fragmentOrigin = "a.style.left=`${(r.contentX-e.box.x)*n}px`";
  if (code.split(before).length !== 2)
    throw new Error("DOCX paint patch target is not unique.");
  if (code.split(origin).length !== 2)
    throw new Error("DOCX line origin patch target is not unique.");
  if (code.split(fragmentOrigin).length !== 2)
    throw new Error("DOCX fragment origin patch target is not unique.");
  return code
    .replace(before, "r.append(R),b+=S,x+=1,d=null,c=null;")
    .replace(
      origin,
      'function yn(t,e,o,n=false){if(e.drawings?.length){const origin=e.drawings.reduce((x,d)=>Math.min(x,d.advanceStart),e.contentX);if(origin!==e.contentX)e={...e,contentX:origin};}let i=o.scale,r=t.createElement("div");',
    )
    .replace(
      fragmentOrigin,
      "a.style.left=`${Number.parseFloat(a.style.left)-e.box.x*n}px`",
    );
}

export function docxPaintPatch() {
  let applied = false;
  return {
    name: "document-studio-docx-inline-paint",
    transform(code, id) {
      if (
        !id.replaceAll("\\", "/").includes("/@docx-editor.dev/core/dist/") ||
        !code.includes("docx-inline-drawing-advance")
      )
        return;
      applied = true;
      return { code: patchDocxPaint(code), map: null };
    },
    generateBundle() {
      if (!applied)
        throw new Error(
          "The bundled DOCX renderer did not include its required inline-image patch.",
        );
    },
  };
}
