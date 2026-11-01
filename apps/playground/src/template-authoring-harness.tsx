import { useState } from "react";
import { createRoot } from "react-dom/client";
import { TemplateAuthoringEditor } from "@document-studio/react";
import {
  sourceBytesHash,
  type EditorDocument,
  type EditorSnapshot,
  type TemplateSelection,
} from "@document-studio/core";
import {
  inspectTemplate,
  type TemplateStructure,
} from "@document-studio/template";
import { docxEngine } from "@document-studio/engine-docx";
import { rhwpEngine } from "@document-studio/engine-rhwp";
import "../../../packages/react/src/styles.css";
const engines = [
  docxEngine(),
  rhwpEngine({ studioUrl: "/editor-assets/rhwp/index.html" }),
];
declare global {
  interface Window {
    templateAuthoring: {
      load(format: "docx" | "hwpx"): Promise<void>;
      select(value: TemplateSelection | null): void;
      reopen(): void;
      state: EditorSnapshot | null;
      structure: TemplateStructure | null;
      log: TemplateSelection[];
      errors: string[];
    };
  }
}
function App() {
  const [document, setDocument] = useState<EditorDocument | null>(null),
    [selection, setSelection] = useState<TemplateSelection | null>(null),
    [hash, setHash] = useState(""),
    [epoch, setEpoch] = useState(0);
  window.templateAuthoring ??= {
    load: async () => {},
    select: () => {},
    reopen: () => {},
    state: null,
    structure: null,
    log: [],
    errors: [],
  };
  const api = window.templateAuthoring;
  api.select = setSelection;
  api.reopen = () => setEpoch((v) => v + 1);
  api.load = async (format) => {
    api.state = null;
    api.log = [];
    api.errors = [];
    const bytes = new Uint8Array(
      await (
        await fetch(`/fixtures/template-authoring.${format}`)
      ).arrayBuffer(),
    );
    api.structure = await inspectTemplate({ bytes, format });
    setHash(await sourceBytesHash(bytes));
    setSelection(null);
    setDocument({
      id: `authoring-${format}`,
      fileName: `fixture.${format}`,
      format,
      bytes,
      version: "1",
    });
  };
  return (
    <div style={{ height: "95vh" }}>
      {document && (
        <TemplateAuthoringEditor
          key={epoch}
          document={document}
          engines={engines}
          sourceHash={hash}
          structureRevision={1}
          initialZoom="actual"
          selection={selection}
          onSelection={(value) => {
            api.log.push(value);
            setSelection(value);
          }}
          onStateChange={(value) => (api.state = value)}
          onError={(error) => api.errors.push(error.message)}
        />
      )}
    </div>
  );
}
createRoot(window.document.getElementById("root")!).render(<App />);
