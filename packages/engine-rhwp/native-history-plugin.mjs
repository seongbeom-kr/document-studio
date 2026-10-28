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
        code = code.replaceAll("\r\n", "\n");
        const importAnchor =
          "import * as _picture from './input-handler-picture';";
        if (code.split(importAnchor).length !== 2)
          throw new Error("Pinned RHWP object helper imports changed.");
        code = code.replace(
          importAnchor,
          `${importAnchor}\nimport * as _connector from './input-handler-connector';`,
        );
        const anchor = "  executeOperation(desc: OperationDescriptor): void {";
        const permissionAnchor =
          "  private isOperationAllowedInEditMode(desc: OperationDescriptor): boolean {";
        if (!code.includes(anchor) || !code.includes(permissionAnchor))
          throw new Error("Pinned RHWP input contract changed.");
        code = code.replace(
          permissionAnchor,
          `${permissionAnchor}
    if (this.documentStudioReadOnly) return false;`,
        );
        code = code.replace(
          anchor,
          `  private documentStudioReadOnly = false;
  private documentStudioPointerEvent: MouseEvent | null = null;
  setDocumentStudioReadOnly(value: boolean): void {
    if (value && !this.documentStudioReadOnly) {
      this.finishDocumentStudioComposition();
      this.finishDocumentStudioObjectGestures();
    }
    this.documentStudioReadOnly = value;
    if (value) this.removeFormOverlay();
    this.textarea.readOnly = value;
  }

  private cancelDocumentStudioObjectPlacement(): void {
    if (this.imagePlacementMode) this.cancelImagePlacement();
    if (this.textboxPlacementMode) this.cancelTextboxPlacement();
    if (this.polygonDrawingMode) this.cancelPolygonDrawing();
    if (this.connectorDrawingMode) _connector.exitConnectorDrawingMode.call(this);
  }

  private finishDocumentStudioObjectGestures(): void {
    // Direct native updates already accepted in edit mode need their normal undo record.
    // Use the last real editable pointer event, never fabricated mouseup coordinates.
    const pointer = this.documentStudioPointerEvent;
    if (this.isMoveDragging) this.finishMoveDrag();
    if (this.isPictureMoveDragging) this.finishPictureMoveDrag();
    if (this.isLineEndpointDragging) this.finishLineEndpointDrag();
    if (this.isPictureRotateDragging && pointer) this.finishPictureRotateDrag(pointer);
    if (this.isPictureResizeDragging && pointer) this.finishPictureResizeDrag(pointer);
    // Table resizing is preview-only before mouseup; discard it without applying geometry.
    if (this.isResizeDragging) this.cleanupResizeDrag();
    if (this.isPictureResizeDragging) this.cleanupPictureResizeDrag();
    this.isPictureRotateDragging = false;
    this.pictureRotateState = null;
    this.documentStudioPointerEvent = null;
    this.cancelDocumentStudioObjectPlacement();
  }

  finishDocumentStudioComposition(): void {
    // Commit text already shown in the document before freezing its input stream.
    // A later browser compositionend must not keep the old native composition anchor alive.
    if (this.isComposing) this.onCompositionEnd();
    this.textarea.value = '';
  }

  executeDocumentStudioTextGroup(run: () => void): void {
    this.executeFormattingGroup(run, false);
  }

  executeFormattingGroup(run: () => void, preserveSelection = true): void {
    const before = this.cursor.getPosition();
    const selection = this.getSelection();
    const cur = this.cursor;
    const context: EditContext | null = cur.isInHeaderFooter()
      ? {mode:'headerFooter',sectionIdx:cur.hfSectionIdx,isHeader:cur.headerFooterMode === 'header',applyTo:cur.hfApplyTo,paraIdx:cur.hfParaIdx,charOffset:cur.hfCharOffset,previewPage:cur.hfPreviewPage}
      : cur.isInFootnote() ? {mode:'footnote',sectionIdx:cur.fnSectionIdx,paraIdx:cur.fnParaIdx,controlIdx:cur.fnControlIdx,footnoteIndex:cur.fnFootnoteIndex,pageNum:cur.fnPageNum,innerParaIdx:cur.fnInnerParaIdx,charOffset:cur.fnCharOffset} : null;
    const hf = this.getNonEmptyHeaderFooterSelection();
    const selectionSnapshot = hf ? this.headerFooterSelectionSnapshot(hf) : selection ? {...selection,blockPhase:cur.blockSelectionPhase()} : null;
    let selectionAfterSnapshot = selectionSnapshot;
    const capturePending = () => ({shape: this.pendingCharShape ? {...this.pendingCharShape} : null, anchor: this.pendingCharShapeAnchor ? {...this.pendingCharShapeAnchor} : null});
    const restorePending = (state: ReturnType<typeof capturePending>) => {this.pendingCharShape = state.shape; this.pendingCharShapeAnchor = state.anchor;};
    const pendingBefore = capturePending();
    let pendingAfter = pendingBefore;
    const command: EditCommand = new SnapshotCommand('documentStudioPreset', before, before, () => {
      this.history.beginDocumentStudioGroup();
      let changed = false;
      try { run(); } finally { changed = this.history.endDocumentStudioGroup(); }
      pendingAfter = capturePending();
      if (!preserveSelection) {
        const next = this.getSelection(), nextHf = this.getNonEmptyHeaderFooterSelection();
        selectionAfterSnapshot = nextHf ? this.headerFooterSelectionSnapshot(nextHf) : next ? {...next,blockPhase:cur.blockSelectionPhase()} : null;
      }
      return changed || JSON.stringify(pendingBefore) !== JSON.stringify(pendingAfter) ? this.cursor.getPosition() : null;
    });
    command.editContext = () => context;
    command.selectionBefore = () => selectionSnapshot;
    command.selectionAfter = () => selectionAfterSnapshot;
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
        const formAnchor =
          "  handleFormObjectClick(formHit: FormObjectHitResult, pageIdx: number, _zoom: number): void {";
        if (!code.includes(formAnchor))
          throw new Error("Pinned RHWP form pointer contract changed.");
        code = code.replace(
          formAnchor,
          `${formAnchor}
    // Checkbox/radio and overlay forms write before the operation-history router.
    if (this.documentStudioReadOnly) return;`,
        );
        const comboAnchor =
          "      row.addEventListener('mousedown', (e) => {\n        e.preventDefault();";
        const editAnchor =
          "    const commit = () => {\n      if (committed) return;\n      committed = true;";
        if (
          code.split(comboAnchor).length !== 2 ||
          code.split(editAnchor).length !== 2
        )
          throw new Error("Pinned RHWP form overlay contract changed.");
        code = code.replace(
          comboAnchor,
          `${comboAnchor}
        if (this.documentStudioReadOnly || this.formOverlay !== dropdown) return;`,
        );
        code = code.replace(
          editAnchor,
          `${editAnchor}
      if (this.documentStudioReadOnly || this.formOverlay !== input) return;`,
        );
        for (const method of ["onClick", "onMouseMove"]) {
          const pointerAnchor = `  private ${method}(e: MouseEvent): void {`;
          if (code.split(pointerAnchor).length !== 2)
            throw new Error("Pinned RHWP pointer routing contract changed.");
          code = code.replace(
            pointerAnchor,
            `${pointerAnchor}
    if (!this.documentStudioReadOnly) this.documentStudioPointerEvent = e;
    ${method === "onClick" ? "if (this.documentStudioReadOnly) this.cancelDocumentStudioObjectPlacement();" : ""}`,
          );
        }
        // These helpers write WASM before operation-history admission. Keep text navigation
        // available while refusing selected-object movement and keyboard table resizing.
        for (const call of [
          "_table.startResizeDrag.call(this, edge, pageX, pageY, pageBboxes, shiftResize)",
          "_table.moveSelectedTable.call(this, key)",
          "_table.moveSelectedPicture.call(this, key)",
          "_picture.resizeSelectedPicture.call(this, key)",
          "_table.resizeCellByKeyboard.call(this, key)",
          "_table.resizeCellLocalByKeyboard.call(this, key)",
          "_table.resizeCellBoundaryByKeyboard.call(this, key)",
          "_table.resizeTableProportional.call(this, key)",
        ]) {
          const callAnchor = `    ${call};`;
          if (code.split(callAnchor).length !== 2)
            throw new Error("Pinned RHWP object editing contract changed.");
          code = code.replace(
            callAnchor,
            `    if (this.documentStudioReadOnly) return;
${callAnchor}`,
          );
        }
        return { code, map: null };
      }
      if (id.endsWith("/engine/input-handler-mouse.ts")) {
        code = code.replaceAll("\r\n", "\n");
        const anchor =
          "function bringShapeToFront(this: any, picHit: any): void {";
        if (!code.includes(anchor))
          throw new Error("Pinned RHWP shape pointer contract changed.");
        code = code.replace(
          anchor,
          `${anchor}
  // Selection cannot reorder an object or announce a write rejected by read-only mode.
  if (this.documentStudioReadOnly) return;`,
        );
        for (const [flag, count] of [
          ["isMoveDragging", 1],
          ["isPictureMoveDragging", 2],
          ["isPictureResizeDragging", 2],
          ["isPictureRotateDragging", 1],
          ["isLineEndpointDragging", 1],
        ]) {
          const gestureAnchor = `this.${flag} = true;`;
          if (code.split(gestureAnchor).length !== count + 1)
            throw new Error("Pinned RHWP object gesture contract changed.");
          code = code.replaceAll(
            gestureAnchor,
            `if (this.documentStudioReadOnly) return;
            ${gestureAnchor}`,
          );
        }
        return { code, map: null };
      }
    },
  };
}
