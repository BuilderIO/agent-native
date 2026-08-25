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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--spacing-2)",
      }}
    >
      <label
        htmlFor={id}
        style={{
          fontFamily: "var(--b-font-mono)",
          fontSize: "var(--b-t-label-2)",
          color: "var(--b-text-secondary)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </label>
      <Select id={id} options={options} value={value} onChange={onChange} />
    </div>
  );
}
