import type { DocumentFontReport } from "@document-studio/core";
import { useId, useState } from "react";
export function FontStatus({ report }: { report?: DocumentFontReport }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  if (!report) return null;
  const changed = report.families.filter((face) => face.status !== "available");
  return (
    <div className="ds-font-status">
      <button
        type="button"
        className="ds-font-status-trigger"
        popoverTarget={id}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
      >
        {!report.ready
          ? "글꼴 자산 확인 필요"
          : changed.length
            ? `대체 글꼴 ${changed.length}개`
            : "기본 글꼴 준비됨"}
      </button>
      <div
        id={id}
        popover="auto"
        role="dialog"
        aria-label="문서 글꼴"
        className="ds-font-status-panel"
        onToggle={(event) =>
          setOpen((event.nativeEvent as ToggleEvent).newState === "open")
        }
      >
        <p>
          문서의 원래 글꼴명은 유지합니다. 대체하면 글자 모양과 줄바꿈이 달라질
          수 있습니다.
        </p>
        {report.failures.map((failure, index) => (
          <p role="alert" key={index}>
            {failure}
          </p>
        ))}
        <ul>
          {report.families.map((face) => (
            <li key={face.requested}>
              {face.requested} →{" "}
              {face.resolved ?? "호스트가 선택한 글꼴 (상세 미제공)"}
              {face.status === "missing"
                ? " · 지원 확인 필요"
                : face.source === "local"
                  ? " · PC 글꼴"
                  : face.source === "provided"
                    ? " · 호스트 제공"
                    : " · 기본 팩"}
              {face.reason === "monospace-font-not-bundled"
                ? " · 고정폭 미보장"
                : ""}
            </li>
          ))}
        </ul>
        {report.truncated && <p>글꼴 목록은 최대 64개까지 표시합니다.</p>}
        {open && (
          <button
            type="button"
            className="ds-button"
            popoverTarget={id}
            popoverTargetAction="hide"
          >
            닫기
          </button>
        )}
      </div>
    </div>
  );
}
