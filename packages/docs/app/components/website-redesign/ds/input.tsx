import type { InputHTMLAttributes } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input(props: InputProps) {
  return (
    <input
      className="focus:border-[var(--b-action-primary-bg)] disabled:opacity-45 disabled:cursor-not-allowed"
      style={{
        fontFamily: "var(--b-font-sans)",
        fontSize: "var(--b-t-paragraph-2)",
        color: "var(--b-text-primary)",
        background: "var(--b-bg-raised)",
        border: "1px solid var(--b-action-secondary-border)",
        borderRadius: "var(--b-radius)",
        padding: "8px 12px",
        outline: "none",
        transition: "border-color 0.15s, background 0.15s",
      }}
      {...props}
    />
  );
}
