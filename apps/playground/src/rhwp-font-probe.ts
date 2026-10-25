import { createEditor, type RhwpEditor, type RendererDiagnosticsV1 } from "@rhwp/editor";

let editor: RhwpEditor | undefined;
declare global {
  interface Window {
    rhwpFontProbe: {
      load(bytes: number[], name: string): Promise<void>;
      diagnostics(): Promise<RendererDiagnosticsV1>;
      export(): Promise<number[]>;
      dispose(): void;
    };
  }
}
window.rhwpFontProbe = {
  async load(bytes, name) {
    editor?.destroy();
    const studioUrl = new URL("/editor-assets/rhwp/index.html", location.href);
    studioUrl.searchParams.set("documentStudioOrigin", location.origin);
    studioUrl.searchParams.set("embed", "true");
    editor = await createEditor("#probe", { studioUrl: studioUrl.href, renderer: "canvaskit" });
    await editor.loadFile(new Uint8Array(bytes), name);
  },
  async diagnostics() {
    if (!editor) throw new Error("Probe editor is not loaded.");
    return editor.getRendererDiagnostics(0);
  },
  async export() {
    if (!editor) throw new Error("Probe editor is not loaded.");
    return [...new Uint8Array(await editor.exportHwpx())];
  },
  dispose() { editor?.destroy(); editor = undefined; },
};
