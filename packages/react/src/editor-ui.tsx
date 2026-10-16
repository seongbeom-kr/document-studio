import {
  Component,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { EditorCommand, EditorSnapshot } from "@document-studio/core";

export const EDITOR_TOOL_TABS = {
  text: "글자",
  paragraph: "문단",
  table: "표",
  image: "그림",
  page: "페이지",
  search: "찾기와 바꾸기",
  presets: "보고서 서식",
  automation: "업무 자동화",
  quick: "빠른 작업",
  mailMerge: "서식·메일머지",
} as const;
export type EditorToolTab = keyof typeof EDITOR_TOOL_TABS;
export type EditorUIRegion = "toolbar" | "statusBar" | "tools";
export interface EditorTheme {
  accent?: string;
  accentForeground?: string;
  background?: string;
  panel?: string;
  text?: string;
  muted?: string;
  border?: string;
  radius?: string;
  fontFamily?: string;
}
export interface EditorUIOptions {
  /** Connected elements in the editor's document. Only SDK-owned children are moved/removed. */
  containers?: Partial<Record<EditorUIRegion, HTMLElement>>;
  theme?: EditorTheme;
}
export interface EditorUIContext {
  snapshot: EditorSnapshot;
  readOnly: boolean;
  defaultContent: ReactNode;
  toolsOpen: boolean;
  nativeTools: boolean;
  fitWidth: boolean;
  /** The same guarded command path used by the default toolbar and public controller. */
  execute(command: EditorCommand): Promise<void>;
  openTools(tab?: EditorToolTab): void;
  closeTools(): void;
  setNativeTools(open: boolean): void;
  setZoom(value: number | "width"): void;
}
export interface EditorUISlots {
  toolbar?: (context: EditorUIContext) => ReactNode;
  statusBar?: (context: EditorUIContext) => ReactNode;
}

const themeKeys = {
  accent: "--ds-accent",
  accentForeground: "--ds-accent-foreground",
  background: "--ds-background",
  panel: "--ds-panel",
  text: "--ds-text",
  muted: "--ds-muted",
  border: "--ds-border",
  radius: "--ds-radius",
  fontFamily: "fontFamily",
} as const;
export function editorThemeStyle(theme?: EditorTheme): CSSProperties {
  return Object.fromEntries(
    Object.entries(themeKeys).flatMap(([key, property]) => {
      const value = theme?.[key as keyof EditorTheme];
      return value === undefined ? [] : [[property, value]];
    }),
  );
}
export function validateEditorUI(
  ui: EditorUIOptions | undefined,
  owner: Document,
): void {
  for (const target of Object.values(ui?.containers ?? {})) {
    if (target === undefined) continue;
    const ElementClass = owner.defaultView?.HTMLElement;
    if (
      !ElementClass ||
      !(target instanceof ElementClass) ||
      target.ownerDocument !== owner ||
      !target.isConnected
    )
      throw new TypeError(
        "UI 영역은 편집기와 같은 문서에 연결된 HTML 요소여야 합니다.",
      );
    if (target.closest(".ds-ui-region, .ds-editor"))
      throw new TypeError(
        "UI 영역은 SDK 내부 요소가 아닌 호스트 소유 요소여야 합니다.",
      );
  }
}

class SlotBoundary extends Component<
  {
    children: ReactNode;
    fallback: ReactNode;
    onError(error: Error): void;
  },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError(
      new Error("앱의 편집 도구를 표시하지 못해 기본 도구로 전환했습니다."),
    );
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
function CustomSlot({
  render,
  context,
}: {
  render: (context: EditorUIContext) => ReactNode;
  context: EditorUIContext;
}) {
  return render(context);
}

/** A stable portal target preserves form state when the host changes the destination. */
export function EditorRegion({
  name,
  target,
  appearance,
  theme,
  children,
  render,
  context,
  onError,
  owner,
  blocked,
}: {
  name: EditorUIRegion;
  target?: HTMLElement;
  appearance?: "standalone" | "embedded";
  theme?: EditorTheme;
  children: ReactNode;
  render?: (context: EditorUIContext) => ReactNode;
  context?: Omit<EditorUIContext, "defaultContent">;
  onError(error: Error): void;
  owner: string;
  blocked: boolean;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const [surface, setSurface] = useState<HTMLDivElement | null>(null);
  const report = useRef(onError);
  report.current = onError;
  useLayoutEffect(() => {
    const element = anchor.current!.ownerDocument.createElement("div");
    element.className = "ds-ui-region ds-ui-scope";
    element.dataset.region = name;
    setSurface(element);
    return () => element.remove();
  }, [name]);
  useLayoutEffect(() => {
    if (!surface || !anchor.current) return;
    try {
      validateEditorUI(
        { containers: { [name]: target } },
        surface.ownerDocument,
      );
      const destination = target ?? anchor.current;
      if (surface.contains(destination))
        throw new TypeError("UI 영역을 자기 내부로 이동할 수 없습니다.");
      if (surface.parentElement !== destination) {
        const focused = surface.ownerDocument
          .activeElement as HTMLElement | null;
        const restoreFocus = focused && surface.contains(focused);
        destination.append(surface);
        if (restoreFocus) focused.focus({ preventScroll: true });
      }
      surface.dataset.external = String(Boolean(target));
    } catch (error) {
      // Invalid updates retain the previous destination, including unsaved fields.
      if (!surface.isConnected) anchor.current.append(surface);
      report.current(error instanceof Error ? error : new Error(String(error)));
    }
  }, [surface, target, name]);
  useLayoutEffect(() => {
    if (!surface) return;
    surface.dataset.documentStudioOwner = owner;
    surface.inert = blocked;
  }, [surface, owner, blocked]);
  useLayoutEffect(() => {
    if (!surface) return;
    surface.dataset.appearance = appearance ?? "standalone";
    surface.removeAttribute("style");
    for (const [key, value] of Object.entries(editorThemeStyle(theme))) {
      if (key === "fontFamily") surface.style.fontFamily = String(value);
      else surface.style.setProperty(key, String(value));
    }
  }, [surface, appearance, theme]);
  return (
    <>
      <div ref={anchor} className="ds-ui-anchor" data-region={name} />
      {surface &&
        createPortal(
          render && context ? (
            <SlotBoundary fallback={children} onError={onError}>
              <CustomSlot
                render={render}
                context={{ ...context, defaultContent: children }}
              />
            </SlotBoundary>
          ) : (
            children
          ),
          surface,
        )}
    </>
  );
}
