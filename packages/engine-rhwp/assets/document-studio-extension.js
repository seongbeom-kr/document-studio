// Downstream extension using RHWP's public automation command registration API.
// Kept outside upstream sources; pinned against e8800c8def63449808a4092798442652ed460552.
const parentOrigin = new URL(location.href).searchParams.get(
  "documentStudioOrigin",
);
if (!parentOrigin || !/^https?:\/\//.test(parentOrigin))
  throw new Error("Document Studio parent origin is required.");
let revision = 0;
let boundServices;
let sdkInputDepth = 0;
let inputBlocked =
  new URL(location.href).searchParams.get("documentStudioInputBlocked") ===
  "true";
const applyInputBlock = (blocked) => {
  inputBlocked = blocked;
  // The browser does not consistently propagate a parent's inert state into a focused iframe.
  // Freeze in the iframe itself, including a textarea created after the initial handshake.
  document.documentElement.inert = blocked;
  for (const textarea of document.querySelectorAll(
    'textarea[aria-label="문서 편집 입력"]',
  )) {
    textarea.readOnly = blocked;
    if (blocked) textarea.value = "";
  }
  if (blocked) document.activeElement?.blur?.();
};
applyInputBlock(inputBlocked);
new MutationObserver(() => {
  if (inputBlocked)
    for (const textarea of document.querySelectorAll(
      'textarea[aria-label="문서 편집 입력"]',
    ))
      textarea.readOnly = true;
}).observe(document.documentElement, { childList: true, subtree: true });
for (const type of [
  "keydown",
  "beforeinput",
  "input",
  "paste",
  "cut",
  "drop",
  "compositionstart",
  "compositionupdate",
  "compositionend",
  "pointerdown",
  "click",
  "dblclick",
  "contextmenu",
]) {
  window.addEventListener(
    type,
    (event) => {
      if (!inputBlocked || sdkInputDepth > 0) return;
      // Retain the host find shortcut and copy. All document editing handlers run after this guard.
      if (
        type === "keydown" &&
        (event.ctrlKey || event.metaKey) &&
        ["c", "f"].includes(event.key.toLowerCase())
      )
        return;
      if (type === "input" && event.target instanceof HTMLTextAreaElement)
        event.target.value = "";
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );
}
document.addEventListener(
  "keydown",
  (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.parent.postMessage({ type: "document-studio:find" }, parentOrigin);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.parent.postMessage({ type: "document-studio:save" }, parentOrigin);
    }
  },
  true,
);
const poll = setInterval(() => {
  const automation = window.rhwpStudio?.automation;
  if (!automation) return;
  clearInterval(poll);
  automation.registerCommand({
    id: "ext:document-studio:input-block",
    label: "Document Studio 입력 잠금",
    canExecute: () => true,
    execute(services, params) {
      if (typeof params?.blocked !== "boolean")
        throw new Error("Invalid input lock.");
      if (params.blocked && !inputBlocked) {
        const input = services.getInputHandler();
        if (input && !input.finishDocumentStudioComposition)
          throw new Error("HWPX 입력 잠금 런타임을 최신화해 주세요.");
        input?.finishDocumentStudioComposition();
      }
      applyInputBlock(params.blocked);
    },
  });
  const editable = (ctx) =>
    ctx.hasDocument && ctx.isEditable && !ctx.isFormMode;
  const selectionKey = (services) => {
    const input = services.getInputHandler();
    return JSON.stringify({
      cursor: input?.getCursorPosition() ?? null,
      range: input?.getSelection() ?? null,
      cells: input?.getSelectedCellRange() ?? null,
      table: input?.getSelectedTableRef() ?? null,
      pictures: input?.getSelectedPictureRefs() ?? [],
    });
  };
  const assertSelection = (services, params) => {
    if (
      params.expectedSelectionKey !== undefined &&
      services.getInputHandler()?.hasExcludedCellSelection()
    )
      throw new Error(
        "비직사각형 셀 선택은 에이전트 범위 보호를 지원하지 않습니다. 텍스트 범위를 다시 선택해 주세요.",
      );
    if (
      params.expectedSelectionKey !== undefined &&
      params.expectedSelectionKey !== selectionKey(services)
    )
      throw new Error(
        "선택 범위가 변경됐습니다. 적용 대상을 다시 확인해 주세요.",
      );
  };
  const snapshot = (services, version = revision) => {
    const input = services.getInputHandler();
    const pos = input?.getCursorPosition();
    const page = pos ? services.wasm.getPageDef(pos.sectionIndex) : undefined;
    const table =
      pos?.parentParaIndex !== undefined
        ? services.wasm.getTableDimensions(
            pos.sectionIndex,
            pos.parentParaIndex,
            pos.controlIndex,
          )
        : undefined;
    return {
      revision: version,
      tableColumnEditing: true,
      atomicTextInsertion:
        typeof services.getInputHandler()?.executeDocumentStudioTextGroup ===
        "function",
      selectionKey: selectionKey(services),
      selectionGuardedCommands:
        Boolean(input) && !input.hasExcludedCellSelection(),
      selectionDescription: pos
        ? pos.cellIndex !== undefined
          ? `표 셀 ${pos.cellIndex + 1} · 글자 위치 ${pos.charOffset}`
          : `본문 ${pos.paragraphIndex + 1}문단 · 글자 위치 ${pos.charOffset}`
        : "선택 위치 없음",
      character: {
        ...(input?.getCharProperties() ?? {}),
        ...(input?.getPendingCharShape() ?? {}),
      },
      paragraph: input?.getParaProperties() ?? {},
      context: services.getContext(),
      pageCount: services.wasm.pageCount,
      page,
      table,
    };
  };
  const allowedCommands = new Set([
    "edit:select-all",
    "edit:undo",
    "edit:redo",
    "format:bold",
    "format:italic",
    "format:underline",
    "format:align-left",
    "format:align-center",
    "format:align-right",
    "format:align-justify",
    "format:line-spacing",
    "ext:document-studio:font-family",
    "ext:document-studio:font-size",
    "ext:document-studio:zoom",
    "format:strikethrough",
    "format:superscript",
    "format:subscript",
    "format:toggle-bullet",
    "format:toggle-numbering",
    "page:break",
    "table:insert-row-above",
    "table:insert-row-below",
    "table:insert-col-left",
    "table:insert-col-right",
    "table:delete-row",
    "table:delete-col",
    "table:delete",
    "table:cell-merge",
    "ext:document-studio:text-color",
    "ext:document-studio:highlight-color",
    "ext:document-studio:character-spacing",
    "ext:document-studio:character-scale",
    "ext:document-studio:paragraph",
    "ext:document-studio:page",
    "ext:document-studio:table",
    "ext:document-studio:split-cell",
    "ext:document-studio:cell-fill",
    "ext:document-studio:cell-align",
    "ext:document-studio:table-borders",
    "ext:document-studio:image",
    "ext:document-studio:text",
    "ext:document-studio:line-break",
  ]);
  automation.registerCommand({
    id: "ext:document-studio:execute",
    label: "Document Studio 명령",
    canExecute: (ctx) => ctx.hasDocument,
    execute(services, params) {
      assertSelection(services, params);
      if (!allowedCommands.has(params?.commandId))
        throw new Error("Unsupported Document Studio command.");
      if (
        params.expectedRevision !== undefined &&
        params.expectedRevision !== String(revision)
      )
        throw new Error("편집 revision이 변경됐습니다.");
      sdkInputDepth++;
      try {
        const result = automation.execute(params.commandId, params.parameters);
        if (!result.ok) throw new Error(result.message ?? result.reason);
      } finally {
        sdkInputDepth--;
      }
    },
  });
  automation.registerCommand({
    id: "ext:document-studio:preset",
    label: "서식 묶음 적용",
    canExecute: editable,
    execute(services, params) {
      assertSelection(services, params);
      if (
        !Array.isArray(params?.commands) ||
        !params.commands.length ||
        params.commands.length > 64
      )
        throw new Error("서식 명령 수가 허용 범위를 벗어났습니다.");
      if (params.expectedRevision !== String(revision))
        throw new Error("서식 revision이 변경됐습니다.");
      const formatting = new Set(
        [...allowedCommands].filter(
          (id) =>
            id.startsWith("format:") ||
            /ext:document-studio:(font-family|font-size|text-color|highlight-color|character-spacing|character-scale|paragraph)$/.test(
              id,
            ),
        ),
      );
      for (const command of params.commands) {
        if (
          !formatting.has(command.commandId) ||
          !automation.isEnabled(command.commandId)
        )
          throw new Error("현재 선택에서 지원하지 않는 서식입니다.");
      }
      const input = services.getInputHandler();
      if (!input?.executeFormattingGroup)
        throw new Error("서식 묶음 런타임을 최신화해 주세요.");
      input.executeFormattingGroup(() => {
        for (const command of params.commands) {
          const result = automation.execute(
            command.commandId,
            command.parameters,
          );
          if (!result.ok) throw new Error(result.message ?? result.reason);
        }
      });
    },
  });
  // Version-pinned service operations. Every document write goes through the native undo router.
  const numeric = (value, min, max) => {
    if (!Number.isFinite(value) || value < min || value > max)
      throw new Error("명령 값이 허용 범위를 벗어났습니다.");
    return value;
  };
  const color = (value) => {
    if (typeof value !== "string" || !/^#[a-f\d]{6}$/i.test(value))
      throw new Error("색상이 올바르지 않습니다.");
    return value;
  };
  const register = (name, label, execute, enabled = editable) =>
    automation.registerCommand({
      id: `ext:document-studio:${name}`,
      label,
      canExecute: enabled,
      execute,
    });
  const operation = (services, name, mutate) => {
    const input = services.getInputHandler();
    if (!input) throw new Error("편집기를 준비하는 중입니다.");
    const pos = input.getCursorPosition();
    let applied = false;
    input.executeOperation({
      kind: "snapshot",
      operationType: `documentStudio:${name}`,
      operation(wasm) {
        const next = mutate(wasm, pos, input);
        applied = true;
        return next ?? pos;
      },
    });
    if (!applied)
      throw new Error("현재 편집 모드에서는 명령을 적용할 수 없습니다.");
    input.focusTextarea();
  };
  register("text-color", "글자색", (services, params) =>
    services.eventBus.emit("format-char", { textColor: color(params.value) }),
  );
  register("highlight-color", "강조색", (services, params) =>
    services.eventBus.emit("format-char", { shadeColor: color(params.value) }),
  );
  register("character-spacing", "자간", (services, params) => {
    const pt = numeric(params.value, -20, 100);
    const fontPt =
      (services.getInputHandler().getCharProperties().fontSize ?? 1000) / 100;
    const percent = Math.round((pt / fontPt) * 100);
    if (percent < -50 || percent > 50)
      throw new Error("현재 글자 크기에서 HWPX 자간 범위는 -50~50%입니다.");
    services.eventBus.emit("format-char", { spacings: Array(7).fill(percent) });
  });
  register("character-scale", "장평", (services, params) =>
    services.eventBus.emit("format-char", {
      ratios: Array(7).fill(numeric(params.value, 50, 200)),
    }),
  );
  register("paragraph", "문단 설정", (services, params) => {
    const value = params.value;
    if (!value || typeof value !== "object")
      throw new Error("문단 서식이 필요합니다.");
    const mods = {};
    for (const [key, target] of [
      ["beforePt", "spacingBefore"],
      ["afterPt", "spacingAfter"],
    ])
      if (value[key] !== undefined)
        mods[target] = Math.round(numeric(value[key], 0, 720) * 100);
    for (const [key, target] of [
      ["leftMm", "marginLeft"],
      ["rightMm", "marginRight"],
      ["firstLineMm", "indent"],
    ])
      if (value[key] !== undefined)
        mods[target] = Math.round(
          (numeric(value[key], key === "firstLineMm" ? -300 : 0, 300) * 14400) /
            25.4,
        );
    if (value.lineSpacing) {
      const rule = value.lineSpacing.rule;
      if (!["multiple", "exact", "atLeast"].includes(rule))
        throw new Error("행간 종류가 올바르지 않습니다.");
      mods.lineSpacingType =
        rule === "multiple"
          ? "Percent"
          : rule === "exact"
            ? "Fixed"
            : "Minimum";
      mods.lineSpacing = Math.round(
        numeric(
          value.lineSpacing.value,
          rule === "multiple" ? 0.5 : 1,
          rule === "multiple" ? 5 : 200,
        ) * 100,
      );
    }
    for (const [key, target] of [
      ["keepNext", "keepWithNext"],
      ["keepLines", "keepLines"],
      ["widowControl", "widowOrphan"],
      ["pageBreakBefore", "pageBreakBefore"],
    ]) {
      if (value[key] !== undefined) {
        if (typeof value[key] !== "boolean")
          throw new Error("문단 옵션이 올바르지 않습니다.");
        mods[target] = value[key];
      }
    }
    if (!Object.keys(mods).length)
      throw new Error("적용할 문단 서식이 없습니다.");
    services.getInputHandler().applyParaPropsAtCursor(mods);
    services.getInputHandler().focusTextarea();
  });
  register("page", "페이지 설정", (services, params) =>
    operation(services, "page", (wasm, pos) => {
      const v = params.value;
      const units = (mm) => Math.round((numeric(mm, 0, 1000) * 7200) / 25.4);
      if (
        !v ||
        !["portrait", "landscape"].includes(v.orientation) ||
        v.leftMm + v.rightMm >= v.widthMm ||
        v.topMm + v.bottomMm >= v.heightMm
      )
        throw new Error("페이지 설정이 올바르지 않습니다.");
      const sections =
        v.scope === "section"
          ? [pos.sectionIndex]
          : Array.from({ length: wasm.getSectionCount() }, (_, index) => index);
      for (const section of sections) {
        const page = {
          ...wasm.getPageDef(section),
          width: units(v.widthMm),
          height: units(v.heightMm),
          marginLeft: units(v.leftMm),
          marginRight: units(v.rightMm),
          marginTop: units(v.topMm),
          marginBottom: units(v.bottomMm),
          landscape: v.orientation === "landscape",
        };
        if (!wasm.setPageDef(section, page).ok)
          throw new Error("페이지 설정을 적용하지 못했습니다.");
      }
    }),
  );
  register(
    "table",
    "표 삽입",
    (services, params) =>
      operation(services, "table", (wasm, pos) => {
        const v = params.value;
        const rows = numeric(v?.rows, 1, 100),
          cols = numeric(v?.columns, 1, 50);
        if (
          !Number.isInteger(rows) ||
          !Number.isInteger(cols) ||
          rows * cols > 2000 ||
          pos.parentParaIndex !== undefined
        )
          throw new Error("현재 위치에 표를 삽입할 수 없습니다.");
        const result = wasm.createTable(
          pos.sectionIndex,
          pos.paragraphIndex,
          pos.charOffset,
          rows,
          cols,
        );
        if (!result.ok) throw new Error("표를 삽입하지 못했습니다.");
        return {
          sectionIndex: pos.sectionIndex,
          paragraphIndex: 0,
          charOffset: 0,
          parentParaIndex: result.paraIdx,
          controlIndex: result.controlIdx,
          cellIndex: 0,
          cellParaIndex: 0,
        };
      }),
    (ctx) => editable(ctx) && !ctx.inTable,
  );
  const cellOperation = (services, name, mutate) =>
    operation(services, name, (wasm, pos, input) => {
      if (pos.parentParaIndex === undefined || (pos.cellPath?.length ?? 0) > 1)
        throw new Error("이 명령은 최상위 표 셀에서 사용할 수 있습니다.");
      const range = input.getSelectedCellRange?.();
      const dims = wasm.getTableDimensions(
        pos.sectionIndex,
        pos.parentParaIndex,
        pos.controlIndex,
      );
      const targets = Array.from(
        { length: dims.cellCount },
        (_, index) => index,
      ).filter((index) => {
        if (!range) return index === pos.cellIndex;
        const cell = wasm.getCellInfo(
          pos.sectionIndex,
          pos.parentParaIndex,
          pos.controlIndex,
          index,
        );
        return (
          cell.row >= range.startRow &&
          cell.row <= range.endRow &&
          cell.col >= range.startCol &&
          cell.col <= range.endCol
        );
      });
      if (!targets.length) throw new Error("선택한 셀이 없습니다.");
      for (const index of targets) mutate(wasm, pos, index);
    });
  register(
    "cell-fill",
    "셀 배경색",
    (services, params) =>
      cellOperation(services, "fill", (wasm, pos, index) => {
        if (
          !wasm.setCellProperties(
            pos.sectionIndex,
            pos.parentParaIndex,
            pos.controlIndex,
            index,
            { fillType: "solid", fillColor: color(params.value) },
          ).ok
        )
          throw new Error("셀 배경을 적용하지 못했습니다.");
      }),
    (ctx) => editable(ctx) && ctx.inTable,
  );
  register(
    "cell-align",
    "셀 세로 정렬",
    (services, params) =>
      cellOperation(services, "align", (wasm, pos, index) => {
        const verticalAlign = ["top", "center", "bottom"].indexOf(params.value);
        if (
          verticalAlign < 0 ||
          !wasm.setCellProperties(
            pos.sectionIndex,
            pos.parentParaIndex,
            pos.controlIndex,
            index,
            { verticalAlign },
          ).ok
        )
          throw new Error("셀 정렬을 적용하지 못했습니다.");
      }),
    (ctx) => editable(ctx) && ctx.inTable,
  );
  register(
    "table-borders",
    "표 테두리",
    (services, params) => {
      const v = params.value;
      if (!v || !["all", "none"].includes(v.scope))
        throw new Error(
          "HWPX 공통 테두리는 전체/없음을 지원합니다. 안쪽/바깥쪽은 확장 도구를 사용해 주세요.",
        );
      const line = {
        type: v.scope === "none" ? 0 : 1,
        // HWP stores an index into the standard 16 physical widths, not pt.
        width: [
          0.1, 0.12, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 1, 1.5, 2, 3, 4,
          5,
        ].reduce(
          (best, mm, index, widths) =>
            Math.abs(mm - (numeric(v.widthPt, 0.25, 6) * 25.4) / 72) <
            Math.abs(widths[best] - (v.widthPt * 25.4) / 72)
              ? index
              : best,
          0,
        ),
        color: color(v.color),
      };
      cellOperation(services, "borders", (wasm, pos, index) => {
        if (
          !wasm.setCellProperties(
            pos.sectionIndex,
            pos.parentParaIndex,
            pos.controlIndex,
            index,
            {
              borderLeft: line,
              borderRight: line,
              borderTop: line,
              borderBottom: line,
            },
          ).ok
        )
          throw new Error("셀 테두리를 적용하지 못했습니다.");
      });
    },
    (ctx) => editable(ctx) && ctx.inTable,
  );
  register(
    "split-cell",
    "셀 분할",
    (services, params) =>
      operation(services, "split-cell", (wasm, pos) => {
        const v = params.value;
        const rows = numeric(v?.rows, 1, 100),
          cols = numeric(v?.columns, 1, 50);
        if (
          !Number.isInteger(rows) ||
          !Number.isInteger(cols) ||
          rows * cols > 2000 ||
          pos.parentParaIndex === undefined ||
          (pos.cellPath?.length ?? 0) > 1
        )
          throw new Error("현재 셀을 분할할 수 없습니다.");
        const info = wasm.getCellInfo(
          pos.sectionIndex,
          pos.parentParaIndex,
          pos.controlIndex,
          pos.cellIndex,
        );
        if (
          !wasm.splitTableCellInto(
            pos.sectionIndex,
            pos.parentParaIndex,
            pos.controlIndex,
            info.row,
            info.col,
            rows,
            cols,
            true,
            false,
          ).ok
        )
          throw new Error("셀을 분할하지 못했습니다.");
      }),
    (ctx) => editable(ctx) && ctx.inTable,
  );
  register("image", "그림 삽입", (services, params) =>
    operation(services, "image", (wasm, pos, input) => {
      const v = params.value;
      if (
        !Array.isArray(v?.bytes) ||
        !v.bytes.length ||
        v.bytes.length > 8 * 1024 * 1024
      )
        throw new Error("그림 크기가 올바르지 않습니다.");
      const width = ((v.widthMm ?? 40) * 7200) / 25.4,
        height = ((v.heightMm ?? 30) * 7200) / 25.4;
      let path = pos.cellPath;
      if (!path && pos.parentParaIndex !== undefined)
        path = [
          {
            controlIndex: pos.controlIndex,
            cellIndex: pos.cellIndex,
            cellParaIndex: pos.cellParaIndex ?? 0,
          },
        ];
      const result = wasm.insertPicture(
        pos.sectionIndex,
        pos.parentParaIndex ?? pos.paragraphIndex,
        pos.charOffset,
        path ? JSON.stringify(path) : "",
        new Uint8Array(v.bytes),
        Math.round(width),
        Math.round(height),
        numeric(v.naturalWidth, 1, 20000),
        numeric(v.naturalHeight, 1, 20000),
        v.mimeType === "image/jpeg"
          ? "jpg"
          : v.mimeType === "image/gif"
            ? "gif"
            : "png",
        v.alt ?? "",
      );
      if (!result.ok) throw new Error("그림을 삽입하지 못했습니다.");
      if (!path?.length) {
        const formatted = wasm.setPictureProperties(
          pos.sectionIndex,
          result.paraIdx,
          result.controlIdx,
          { treatAsChar: true },
        );
        if (!formatted.ok)
          throw new Error("그림을 본문 안에 배치하지 못했습니다.");
        input.cursor.clearSelection();
        return {
          sectionIndex: pos.sectionIndex,
          paragraphIndex: result.paraIdx,
          charOffset: result.logicalOffset ?? pos.charOffset + 1,
        };
      }
    }),
  );
  register("text", "텍스트 입력", (services, params) => {
    if (
      typeof params.value !== "string" ||
      !params.value.length ||
      params.value.length > 1_000_000
    )
      throw new Error("텍스트가 올바르지 않습니다.");
    const input = services.getInputHandler();
    input.focusTextarea();
    const textarea = document.querySelector(
      'textarea[aria-label="문서 편집 입력"]',
    );
    if (!textarea) throw new Error("문서 입력을 준비하지 못했습니다.");
    if (!input.executeDocumentStudioTextGroup)
      throw new Error(
        "텍스트를 한 번에 되돌릴 수 있도록 HWPX 런타임 자산을 갱신해 주세요.",
      );
    input.executeDocumentStudioTextGroup(() => {
      textarea.value = params.value;
      textarea.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: params.value,
        }),
      );
    });
  });
  register("line-break", "줄 나누기", (services) => {
    const input = services.getInputHandler();
    input.focusTextarea();
    const textarea = document.querySelector(
      'textarea[aria-label="문서 편집 입력"]',
    );
    if (!textarea) throw new Error("문서 입력을 준비하지 못했습니다.");
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  const searchCache = new Map();
  const tableCache = new Map();
  const readTable = (services) => {
    const input = services.getInputHandler(),
      pos = input?.getCursorPosition(),
      wasm = services.wasm;
    if (
      !pos ||
      pos.parentParaIndex === undefined ||
      (pos.cellPath?.length ?? 0) > 1 ||
      input.hasExcludedCellSelection()
    )
      throw new Error("본문의 단순한 표 셀을 선택해 주세요.");
    const dims = wasm.getTableDimensions(
      pos.sectionIndex,
      pos.parentParaIndex,
      pos.controlIndex,
    );
    if (!dims || dims.cellCount > 2000 || dims.colCount > 50)
      throw new Error("표 크기 제한을 넘었습니다.");
    const tableId = crypto.randomUUID();
    const cells = Array.from({ length: dims.cellCount }, (_, index) => {
      const location = [
        pos.sectionIndex,
        pos.parentParaIndex,
        pos.controlIndex,
        index,
      ];
      const info = wasm.getCellInfo(...location),
        count = wasm.getCellParagraphCount(...location),
        props = wasm.getCellProperties(...location);
      const text = Array.from({ length: Math.min(count, 100) }, (_, p) =>
        wasm.getTextInCell(...location, p, 0, 10001),
      ).join("\n");
      const reason =
        info.rowSpan !== 1 || info.colSpan !== 1
          ? "병합 셀 제외"
          : props.cellProtect
            ? "보호된 셀 제외"
            : count !== 1
              ? "여러 문단 셀 제외"
              : text.length > 10000
                ? "셀 길이 제한 초과"
                : undefined;
      return {
        id: `${tableId}:${index}`,
        row: info.row + 1,
        column: info.col + 1,
        rowSpan: info.rowSpan,
        columnSpan: info.colSpan,
        text,
        editable: !reason,
        reason,
      };
    });
    if (cells.reduce((n, c) => n + c.text.length, 0) > 1_000_000)
      throw new Error("표 텍스트 크기 제한을 넘었습니다.");
    const selected = wasm.getCellInfo(
      pos.sectionIndex,
      pos.parentParaIndex,
      pos.controlIndex,
      pos.cellIndex,
    );
    const table = {
      tableId,
      label: `본문 ${pos.sectionIndex + 1}구역 ${pos.parentParaIndex + 1}문단 표 (${dims.rowCount}행 × ${dims.colCount}열)`,
      revision: String(revision),
      selectionKey: selectionKey(services),
      rows: dims.rowCount,
      columns: dims.colCount,
      selectedColumn: selected.col + 1,
      cells,
      location: {
        section: pos.sectionIndex,
        paragraph: pos.parentParaIndex,
        control: pos.controlIndex,
      },
    };
    if (tableCache.size >= 12)
      tableCache.delete(tableCache.keys().next().value);
    tableCache.set(tableId, { table, pos: { ...pos } });
    return table;
  };
  let searchSequence = 0;
  const textAt = (wasm, hit, start, count) => {
    if (hit.cellPath?.length > 1)
      return wasm.getTextInCellByPath(
        hit.sec,
        hit.para,
        JSON.stringify(hit.cellPath),
        start,
        count,
      );
    const c = hit.cellContext;
    return c
      ? wasm.getTextInCell(
          hit.sec,
          c.parentPara,
          c.ctrlIdx,
          c.cellIdx,
          c.cellPara,
          start,
          count,
        )
      : wasm.getTextRange(hit.sec, hit.para, start, count);
  };
  const search = (services, params) => {
    if (
      typeof params.query !== "string" ||
      !params.query.length ||
      params.query.length > 1024
    )
      throw new Error("검색어가 올바르지 않습니다.");
    const found = services.wasm
      .searchAllText(params.query, Boolean(params.matchCase), true)
      .filter((hit) => {
        if (hit.equationControl !== undefined) return false;
        if (!params.wholeWord) return true;
        const before = hit.charOffset
          ? textAt(services.wasm, hit, hit.charOffset - 1, 1)
          : "";
        const after = textAt(
          services.wasm,
          hit,
          hit.charOffset + hit.length,
          1,
        );
        return !/[\p{L}\p{N}_]/u.test(before) && !/[\p{L}\p{N}_]/u.test(after);
      });
    return found;
  };
  const checkExpected = (params) => {
    if (params.expectedRevision !== String(revision)) {
      const error = new Error(
        "검색 결과의 revision이 변경됐습니다. 다시 검색해 주세요.",
      );
      error.conflict = true;
      throw error;
    }
  };
  const cached = (params) => {
    checkExpected(params);
    const found = searchCache.get(params.id ?? params.matchId);
    if (!found || found.revision !== String(revision)) {
      const error = new Error("검색 결과가 만료됐습니다. 다시 검색해 주세요.");
      error.conflict = true;
      throw error;
    }
    return found.hit;
  };
  register(
    "rpc",
    "문서 탐색",
    (services, payload) => {
      let tableWriteStarted = false;
      try {
        const params = payload.params ?? {};
        let result;
        if (payload.method === "readTable") {
          result = readTable(services);
        } else if (payload.method === "applyTableChanges") {
          checkExpected(params);
          assertSelection(services, params);
          if (!editable(services.getContext()))
            throw new Error("현재 문서는 표 편집을 허용하지 않습니다.");
          const cached = tableCache.get(params.tableId);
          if (
            !cached ||
            cached.table.revision !== String(revision) ||
            cached.table.selectionKey !== selectionKey(services)
          )
            throw new Error("표 미리보기가 만료됐습니다.");
          if (!Array.isArray(params.changes) || params.changes.length > 2000)
            throw new Error("셀 변경 목록이 올바르지 않습니다.");
          const ids = new Set(),
            position = cached.pos;
          const targets = params.changes.map((change) => {
            const index = cached.table.cells.findIndex(
                (c) => c.id === change.cellId,
              ),
              cell = cached.table.cells[index];
            if (
              !cell?.editable ||
              ids.has(cell.id) ||
              cell.text !== change.before ||
              typeof change.after !== "string" ||
              change.after.length > 10000 ||
              /[\u0000-\u001f\u007f]/.test(change.after)
            )
              throw new Error("셀 변경 값이 올바르지 않습니다.");
            ids.add(cell.id);
            return {
              index,
              ...change,
              length: services.wasm.getCellParagraphLength(
                position.sectionIndex,
                position.parentParaIndex,
                position.controlIndex,
                index,
                0,
              ),
            };
          });
          const textAtCell = (target) =>
            services.wasm.getTextInCell(
              position.sectionIndex,
              position.parentParaIndex,
              position.controlIndex,
              target.index,
              0,
              0,
              10001,
            );
          if (targets.some((t) => textAtCell(t) !== t.before))
            throw new Error("셀 값이 미리보기와 다릅니다.");
          if (targets.length)
            try {
              tableWriteStarted = true;
              operation(services, "table-column", (wasm) => {
                for (const target of targets) {
                  const location = [
                    position.sectionIndex,
                    position.parentParaIndex,
                    position.controlIndex,
                    target.index,
                    0,
                  ];
                  // The deferred replacement lane accepts only 1..8 characters. Use full native edits,
                  // inside the enclosing snapshot transaction, and retain the original first run.
                  if (target.after) {
                    const raw = wasm.insertTextInCell(
                        ...location,
                        0,
                        target.after,
                      ),
                      inserted =
                        typeof raw === "string" ? JSON.parse(raw) : raw;
                    if (!inserted.ok)
                      throw new Error("셀 삽입이 거절됐습니다.");
                  }
                  const insertedLength =
                    wasm.getCellParagraphLength(...location) - target.length;
                  if (target.length) {
                    const raw = wasm.deleteTextInCell(
                        ...location,
                        insertedLength,
                        target.length,
                      ),
                      deleted = typeof raw === "string" ? JSON.parse(raw) : raw;
                    if (!deleted.ok) throw new Error("셀 치환이 거절됐습니다.");
                  }
                }
              });
            } catch (cause) {
              const error =
                cause instanceof Error ? cause : new Error(String(cause));
              error.effect =
                !(error instanceof AggregateError) &&
                targets.every((t) => textAtCell(t) === t.before)
                  ? "rolled-back"
                  : "unknown";
              throw error;
            }
          result = { changedCells: targets.length };
        } else if (payload.method === "search") {
          const found = search(services, params);
          searchCache.clear();
          const limit = Math.min(500, Math.max(1, params.maxResults ?? 100));
          result = {
            revision: String(revision),
            total: found.length,
            truncated: found.length > limit,
            matches: found.slice(0, limit).map((hit) => {
              const id = `${revision}:${++searchSequence}`;
              searchCache.set(id, { revision: String(revision), hit });
              return {
                id,
                text: textAt(services.wasm, hit, hit.charOffset, hit.length),
                before: textAt(
                  services.wasm,
                  hit,
                  Math.max(0, hit.charOffset - 40),
                  Math.min(40, hit.charOffset),
                ),
                after: textAt(
                  services.wasm,
                  hit,
                  hit.charOffset + hit.length,
                  40,
                ),
              };
            }),
          };
        } else if (payload.method === "select") {
          const hit = cached(params),
            input = services.getInputHandler();
          const c = hit.cellContext;
          const start = {
            sectionIndex: hit.sec,
            paragraphIndex: hit.para,
            charOffset: hit.charOffset,
            ...(c
              ? {
                  parentParaIndex: c.parentPara,
                  controlIndex: c.ctrlIdx,
                  cellIndex: c.cellIdx,
                  cellParaIndex: c.cellPara,
                }
              : {}),
            ...(hit.cellPath?.length
              ? { cellPath: hit.cellPath }
              : c
                ? {
                    cellPath: [
                      {
                        controlIndex: c.ctrlIdx,
                        cellIndex: c.cellIdx,
                        cellParaIndex: c.cellPara,
                      },
                    ],
                  }
                : {}),
          };
          // The pinned upstream FindDialog uses this same cursor path for cell-aware navigation.
          input.cursor.clearSelection();
          input.cursor.moveTo(start);
          input.cursor.setAnchor();
          input.cursor.moveTo({
            ...start,
            charOffset: hit.charOffset + hit.length,
          });
          input.updateCaret();
          input.focusTextarea();
          result = { selected: true };
        } else if (payload.method === "replace") {
          checkExpected(params);
          if (
            typeof params.replacement !== "string" ||
            params.replacement.length > 1_000_000
          )
            throw new Error("바꿀 내용이 올바르지 않습니다.");
          const hits = params.all ? search(services, params) : [cached(params)];
          if (hits.some((hit) => hit.cellPath?.length > 1))
            throw new Error(
              "중첩 표의 자동 치환은 지원하지 않습니다. 표를 직접 편집해 주세요.",
            );
          if (hits.length)
            operation(services, "replace", (wasm) => {
              for (const hit of [...hits].reverse()) {
                const c = hit.cellContext;
                const changed = c
                  ? wasm.replaceTextInCellDeferredPagination(
                      hit.sec,
                      c.parentPara,
                      c.ctrlIdx,
                      c.cellIdx,
                      c.cellPara,
                      hit.charOffset,
                      hit.length,
                      params.replacement,
                    )
                  : wasm.replaceText(
                      hit.sec,
                      hit.para,
                      hit.charOffset,
                      hit.length,
                      params.replacement,
                    );
                if (!changed.ok) throw new Error("텍스트를 바꾸지 못했습니다.");
              }
            });
          searchCache.clear();
          result = { count: hits.length };
        } else throw new Error("지원하지 않는 문서 탐색 명령입니다.");
        window.parent.postMessage(
          { type: "document-studio:rpc", requestId: payload.requestId, result },
          parentOrigin,
        );
      } catch (error) {
        window.parent.postMessage(
          {
            type: "document-studio:rpc",
            requestId: payload.requestId,
            error: error instanceof Error ? error.message : String(error),
            conflict: Boolean(error.conflict),
            effect:
              error.effect ??
              (payload.method === "applyTableChanges" && !tableWriteStarted
                ? "none"
                : undefined),
          },
          parentOrigin,
        );
      }
    },
    (ctx) => ctx.hasDocument,
  );
  automation.registerCommand({
    id: "ext:document-studio:zoom",
    label: "확대",
    canExecute: (ctx) => ctx.hasDocument,
    execute(services, params) {
      const value = Number(params?.value);
      if (!Number.isFinite(value) || value < 0.25 || value > 3)
        throw new Error("Invalid zoom.");
      services.getViewportManager()?.setZoom(value);
    },
  });
  automation.registerCommand({
    id: "ext:document-studio:state",
    label: "Document Studio 상태",
    canExecute: (ctx) => ctx.hasDocument,
    execute(services, params) {
      if (!boundServices) {
        boundServices = services;
        const changed = (reason) => {
          // RHWP 0.8.6 also announces deferred page layout as a document change.
          // Its edit was already counted before scheduling the layout. Counting
          // the later notification again dirties a document after a confirmed save.
          if (
            reason === "input-handler-resumable-pagination" ||
            reason === "deferred-pagination-complete" ||
            (typeof reason === "string" &&
              reason.startsWith("deferred-pagination-flush:"))
          )
            return;
          revision++;
          const changedRevision = revision;
          queueMicrotask(() =>
            window.parent.postMessage(
              {
                type: "document-studio:changed",
                state: snapshot(services, changedRevision),
              },
              parentOrigin,
            ),
          );
        };
        // Page-local text edits emit document-mutated without a full document-changed
        // render. Track both signals; revision is an opaque monotonic token, not an edit count.
        services.eventBus.on("document-mutated", changed);
        services.eventBus.on("document-changed", changed);
      }
      window.parent.postMessage(
        {
          type: "document-studio:rhwp-state",
          requestId: params?.requestId,
          state: snapshot(services),
        },
        parentOrigin,
      );
    },
  });
  automation.registerCommand({
    id: "ext:document-studio:font-size",
    label: "글자 크기",
    canExecute: editable,
    execute(services, params) {
      const value = Number(params?.value);
      if (!Number.isFinite(value) || value < 1 || value > 200)
        throw new Error("Invalid font size.");
      services.eventBus.emit("format-char", {
        fontSize: Math.round(value * 100),
      });
    },
  });
  automation.registerCommand({
    id: "ext:document-studio:font-family",
    label: "글꼴",
    canExecute: editable,
    execute(services, params) {
      const value = params?.value;
      if (typeof value !== "string" || !value.trim() || value.length > 128)
        throw new Error("Invalid font family.");
      const fontId = services.wasm.findOrCreateFontId(value);
      if (fontId < 0) throw new Error("글꼴을 문서에 등록하지 못했습니다.");
      services.eventBus.emit("format-char", { fontId });
    },
  });
  // The embed transport is installed by the same module that exposes automation.
  // Do not make the parent wait for unrelated images/fonts to finish their load event.
  const bootId = new URL(location.href).searchParams.get(
    "documentStudioBootId",
  );
  if (bootId)
    window.parent.postMessage(
      { type: "document-studio:frame-ready", bootId },
      parentOrigin,
    );
}, 20);
