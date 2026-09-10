interface ImgPlaceholderProps {
  aspectRatio?: string;
  label?: string;
  rounded?: boolean;
  background?: string;
  bordered?: boolean;
}

export function ImgPlaceholder({
  aspectRatio = "16 / 10",
  label = "Image",
  rounded = true,
  background = "var(--b-bg-prominent)",
  bordered = true,
}: ImgPlaceholderProps) {
  return (
    <div
      className={[
        "flex w-full items-center justify-center font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-2)] uppercase tracking-[0.04em] text-[var(--b-text-muted)]",
        rounded ? "rounded-[var(--b-radius)]" : "rounded-none",
        bordered && "border border-dashed border-[var(--b-border-default)]",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ aspectRatio, background }}
    >
      {label}
    </div>
  );
}
