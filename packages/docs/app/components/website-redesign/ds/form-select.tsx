import { useId } from "react";

import { Select } from "./select";

interface FormSelectProps<T extends string> {
  label: string;
  options: { label: string; value: T }[];
  value: T;
  onChange: (value: T) => void;
}

export function FormSelect<T extends string>({
  label,
  options,
  value,
  onChange,
}: FormSelectProps<T>) {
  const id = useId();
  return (
    <div className="flex flex-col gap-[var(--spacing-2)]">
      <label
        htmlFor={id}
        className="font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-2)] uppercase tracking-[0.04em] text-[var(--b-text-secondary)]"
      >
        {label}
      </label>
      <Select id={id} options={options} value={value} onChange={onChange} />
    </div>
  );
}
