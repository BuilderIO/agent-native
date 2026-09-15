import type { InputHTMLAttributes } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input(props: InputProps) {
  return (
    <input
      className="rounded-[var(--b-radius)] border border-solid border-[var(--b-action-secondary-border)] bg-[var(--b-bg-raised)] px-3 py-2 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-2)] text-[var(--b-text-primary)] outline-none transition-[border-color,background] duration-150 ease-[ease] focus:border-[var(--b-action-primary-bg)] disabled:cursor-not-allowed disabled:opacity-45"
      {...props}
    />
  );
}
