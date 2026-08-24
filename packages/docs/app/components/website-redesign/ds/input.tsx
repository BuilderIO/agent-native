import type { InputHTMLAttributes } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input(props: InputProps) {
  return (
    <input
      style={{
        fontFamily: "var(--b-font-sans)",
        fontSize: "var(--b-t-paragraph-2)",
        color: "var(--b-text-primary)",
        background: "var(--b-bg-raised)",
        border: "1px solid var(--b-action-secondary-border)",
        borderRadius: "var(--b-radius)",
        padding: "8px 12px",
        outline: "none",
      }}
      {...props}
    />
  );
}
