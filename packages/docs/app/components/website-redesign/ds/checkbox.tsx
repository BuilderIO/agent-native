import type { InputHTMLAttributes, ReactNode } from "react";

interface CheckboxProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
> {
  label?: ReactNode;
}

export function Checkbox({ label, id, ...rest }: CheckboxProps) {
  return (
    <label
      htmlFor={id}
      className="inline-flex cursor-pointer items-center gap-[var(--spacing-2)] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-2)] text-[var(--b-text-primary)]"
    >
      <input
        type="checkbox"
        id={id}
        className="h-4 w-4 rounded-[var(--b-radius-sm)] accent-[var(--b-action-primary-bg)] transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[var(--b-text-primary)]"
        {...rest}
      />
      {label}
    </label>
  );
}
