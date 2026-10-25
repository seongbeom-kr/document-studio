# Portable HWPX template runtime

An application can ship a reviewed template, a generator and the native HWPX
runtime together. A server does not need a checkout of this repository.

After installing `@document-studio/engine-rhwp`, run:

```sh
document-studio-rhwp-runtime ./my-template/runtime
```

The command verifies the pinned runtime provenance and every asset digest before
installing `runtime/third_party/rhwp-core`. It preserves the native MIT license
and patch provenance. Repeating the command with the same verified assets is
safe. A damaged installation or a different runtime requires a new destination;
the command does not overwrite it.

In a Node generator, initialize the runtime from the template package:

```js
import { readFile } from "node:fs/promises";
import init, { HwpDocument } from "./runtime/third_party/rhwp-core/rhwp.js";

await init({
  module_or_path: await readFile(
    new URL("./runtime/third_party/rhwp-core/rhwp_bg.wasm", import.meta.url),
  ),
});
const document = new HwpDocument(await readFile("template.hwpx"));
try {
  // Apply validated replacements to the reviewed paragraph/cell positions.
  // Export to a NEW path, reopen the bytes, and verify the intended values.
} finally {
  document.free();
}
```

Template files, logos, customer content and licensed original fonts remain the
application's assets. This runtime does not infer editable fields from arbitrary
documents, run a model, perform OCR, or store files on an application's server.
Treat generation, workspace registration and server storage as separate outcomes.
An application should retain an operation ID and output digest so retries can
inspect the previous result instead of creating duplicate documents.
