import { useEffect, useRef, useState } from "react";
import type { EditorSession } from "@document-studio/core";
import { questionPosition } from "./question-position";

export function useQuestionPosition(
  session: EditorSession | null,
  targetId: string | undefined,
  stale: boolean,
) {
  const host = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [position, setPosition] =
    useState<ReturnType<typeof questionPosition>>();
  useEffect(() => {
    if (!targetId) {
      setPosition(undefined);
      return;
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const update = async () => {
      try {
        const rects = stale
          ? []
          : ((await session?.getQuestionRects?.()) ?? []);
        if (!active || !host.current || !panel.current) return;
        const bounds = host.current.getBoundingClientRect();
        const viewport = {
          left: Math.max(0, bounds.left),
          top: Math.max(0, bounds.top),
          right: Math.min(window.innerWidth, bounds.right),
          bottom: Math.min(window.innerHeight, bounds.bottom),
        };
        const next = questionPosition(
          rects,
          viewport,
          panel.current.offsetWidth,
          panel.current.offsetHeight,
        );
        next.left += viewport.left - bounds.left;
        next.top += viewport.top - bounds.top;
        setPosition((previous) =>
          previous &&
          previous.left === next.left &&
          previous.top === next.top &&
          previous.attached === next.attached
            ? previous
            : next,
        );
      } catch {
        // Geometry is presentation only. A closed/stale engine must not resend a question.
        if (active) setPosition(undefined);
      } finally {
        if (active)
          timer = setTimeout(() => {
            void update();
          }, 150);
      }
    };
    void update();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [session, targetId, stale]);
  return { host, panel, position };
}
