import { ScrubInput, type ScrubInputProps } from "./ScrubInput";

export function nativeNumericDraft(
  draft: string,
  unit: string | undefined,
  min: number | undefined,
  max: number | undefined,
): number | null {
  const text =
    unit && draft.trim().endsWith(unit)
      ? draft.trim().slice(0, -unit.length).trim()
      : draft.trim();
  if (!text) return null;
  const value = Number(text);
  if (
    !Number.isFinite(value) ||
    (min !== undefined && value < min) ||
    (max !== undefined && value > max)
  )
    return null;
  return value;
}

export function NativeNumericScrub(props: ScrubInputProps) {
  const { value, unit, min, max, onChange } = props;
  return (
    <ScrubInput
      {...props}
      textValue={`${value}${unit ?? ""}`}
      onTextCommit={(draft, meta) => {
        const parsed = nativeNumericDraft(draft, unit, min, max);
        if (parsed === null) return { accepted: false };
        if (parsed !== value) onChange(parsed, meta);
        return { accepted: true, displayValue: `${parsed}${unit ?? ""}` };
      }}
    />
  );
}
