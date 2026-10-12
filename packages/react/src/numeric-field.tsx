import { useId } from "react";

export function displayNumber(value: number | undefined): string {
  return value !== undefined && Number.isFinite(value)
    ? String(Number(value.toFixed(2)))
    : "";
}

/** Formatting the display never writes a rounded value back into the document. */
export function NumericField(props: {
  label: string;
  value: number | undefined;
  onChange(value: number): void;
  min: number;
  max: number;
  step?: number;
}) {
  const id = useId();
  const unavailable = props.value === undefined;
  return (
    <label className="ds-field">
      {props.label}
      <input
        type="number"
        aria-label={props.label}
        value={displayNumber(props.value)}
        placeholder={unavailable ? "값 확인 필요" : undefined}
        aria-describedby={unavailable ? id : undefined}
        min={props.min}
        max={props.max}
        step={props.step ?? 0.1}
        onChange={(event) =>
          props.onChange(
            event.target.value === "" ? NaN : Number(event.target.value),
          )
        }
      />
      {unavailable && (
        <span id={id} className="ds-sr-only">
          선택에 여러 값이 있거나 현재 값을 조회할 수 없습니다. 입력한 값만
          적용됩니다.
        </span>
      )}
    </label>
  );
}
