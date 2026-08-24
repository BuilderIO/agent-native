import type { InputHTMLAttributes, ReactNode } from "react";

interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: ReactNode;
}

export function Radio({ label, id, ...rest }: RadioProps) {
  return (
    <label
      htmlFor={id}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--spacing-2)",
        fontFamily: "var(--b-font-sans)",
        fontSize: "var(--b-t-paragraph-2)",
        color: "var(--b-text-primary)",
        cursor: "pointer",
      }}
    >
      <input
        type="radio"
        id={id}
        className="transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[var(--b-text-primary)]"
        style={{ width: 16, height: 16, accentColor: "var(--b-action-primary-bg)" }}
        {...rest}
      />
      {label}
    </label>
  );
}
