interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}

export function Toggle({ checked, onChange, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={[
        "inline-flex h-5 w-9 cursor-pointer items-center rounded-[var(--b-radius-full)] border-none p-[2px] outline-none transition-[background] duration-200 ease-[ease]",
        checked ? "justify-end" : "justify-start",
        // background lives in the class (not inline style) so the real
        // :hover pseudo-class can win over the base color.
        checked
          ? "bg-[var(--b-action-primary-bg)] hover:bg-[var(--b-action-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-text-primary)]"
          : "bg-[var(--b-bg-prominent)] hover:bg-[var(--c-neutral-600)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-text-primary)]",
      ].join(" ")}
    >
      <span
        className={[
          "block h-4 w-4 rounded-[var(--b-radius-full)]",
          "[transition:transform_0.2s_cubic-bezier(0.4,0,0.2,1),background_0.2s]",
          checked
            ? "bg-[var(--b-action-primary-text)]"
            : "bg-[var(--b-text-secondary)]",
        ].join(" ")}
      />
    </button>
  );
}
