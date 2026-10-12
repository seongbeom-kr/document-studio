// Build-time extension of the pinned MIT RHWP runtime; upstream source files remain untouched.
// One outer SnapshotCommand owns rollback and undo; inner native commands retain their effects.
export function nativeHistoryPlugin() {
  return {
    name: "document-studio-native-history-group",
    enforce: "pre",
    transform(code, file) {
      const id = file.replaceAll("\\", "/");
      if (id.endsWith("/engine/history.ts")) {
        if (
          !code.includes("export class CommandHistory {") ||
          !code.includes("    // [Task #2370 클러스터 A]")
        )
          throw new Error("Pinned RHWP history contract changed.");
        code = code.replace(
          "export class CommandHistory {",
          `export class CommandHistory {
  private documentStudioGroup = false;
  private documentStudioChanged = false;
  beginDocumentStudioGroup(): void {
    if (this.documentStudioGroup) throw new Error('Nested formatting group is not allowed.');
    this.documentStudioGroup = true; this.documentStudioChanged = false;
  }
  endDocumentStudioGroup(): boolean {
    this.documentStudioGroup = false; return this.documentStudioChanged;
  }`,
        );
        code = code.replace(
          "    // [Task #2370 클러스터 A]",
          `    if (this.documentStudioGroup) {
      this.documentStudioChanged ||= !command.isNoOp?.();
      command.discard?.(wasm);
      return cursorAfter;
    }
    // [Task #2370 클러스터 A]`,
        );
        return { code, map: null };
      }
      if (id.endsWith("/engine/input-handler.ts")) {
        const anchor = "  executeOperation(desc: OperationDescriptor): void {";
        if (!code.includes(anchor))
          throw new Error("Pinned RHWP input contract changed.");
        code = code.replace(
          anchor,
          `  finishDocumentStudioComposition(): void {
    // Commit text already shown in the document before freezing its input stream.
    // A later browser compositionend must not keep the old native composition anchor alive.
    if (this.isComposing) this.onCompositionEnd();
    this.textarea.value = '';
  }

  executeFormattingGroup(run: () => void): void {
    const before = this.cursor.getPosition();
    const selection = this.getSelection();
    const cur = this.cursor;
    const context: EditContext | null = cur.isInHeaderFooter()
      ? {mode:'headerFooter',sectionIdx:cur.hfSectionIdx,isHeader:cur.headerFooterMode === 'header',applyTo:cur.hfApplyTo,paraIdx:cur.hfParaIdx,charOffset:cur.hfCharOffset,previewPage:cur.hfPreviewPage}
      : cur.isInFootnote() ? {mode:'footnote',sectionIdx:cur.fnSectionIdx,paraIdx:cur.fnParaIdx,controlIdx:cur.fnControlIdx,footnoteIndex:cur.fnFootnoteIndex,pageNum:cur.fnPageNum,innerParaIdx:cur.fnInnerParaIdx,charOffset:cur.fnCharOffset} : null;
    const hf = this.getNonEmptyHeaderFooterSelection();
    const selectionSnapshot = hf ? this.headerFooterSelectionSnapshot(hf) : selection ? {...selection,blockPhase:cur.blockSelectionPhase()} : null;
    const capturePending = () => ({shape: this.pendingCharShape ? {...this.pendingCharShape} : null, anchor: this.pendingCharShapeAnchor ? {...this.pendingCharShapeAnchor} : null});
    const restorePending = (state: ReturnType<typeof capturePending>) => {this.pendingCharShape = state.shape; this.pendingCharShapeAnchor = state.anchor;};
    const pendingBefore = capturePending();
    let pendingAfter = pendingBefore;
    const command: EditCommand = new SnapshotCommand('documentStudioPreset', before, before, () => {
      this.history.beginDocumentStudioGroup();
      let changed = false;
      try { run(); } finally { changed = this.history.endDocumentStudioGroup(); }
      pendingAfter = capturePending();
      return changed || JSON.stringify(pendingBefore) !== JSON.stringify(pendingAfter) ? this.cursor.getPosition() : null;
    });
    command.editContext = () => context;
    command.selectionBefore = () => selectionSnapshot;
    command.selectionAfter = () => selectionSnapshot;
    const nativeUndo = command.undo.bind(command), nativeExecute = command.execute.bind(command);
    let replay = false;
    command.undo = wasm => {const position = nativeUndo(wasm); restorePending(pendingBefore); return position;};
    command.execute = wasm => {const position = nativeExecute(wasm); if(replay) restorePending(pendingAfter); replay = true; return position;};
    try {
      this.history.execute(command, this.wasm);
    } catch (error) {
      restorePending(pendingBefore);
      this.resetDerivedStateAfterHistoryJump();
      this.restoreEditContextAfterHistory(command,before);
      this.restoreSelectionAfterUndo(command);
      this.refreshAfterOperation(undefined, 'full', 'documentStudioPresetRollback', before, before);
      throw error;
    }
    // The document/history commit has succeeded. A paint observer must not report a failed write.
    try {this.refreshAfterOperation(undefined, 'full', 'documentStudioPreset', before, this.cursor.getPosition());}
    catch (paintError) {console.error('Document Studio preset committed; refresh failed', paintError);}
  }

${anchor}`,
        );
        return { code, map: null };
      }
    },
  };
}
