interface ImgPlaceholderProps {
  aspectRatio?: string;
  label?: string;
}

export function ImgPlaceholder({
  aspectRatio = "16 / 10",
  label = "Image",
}: ImgPlaceholderProps) {
  return (
    <div
      style={{
        width: "100%",
        aspectRatio,
        borderRadius: "var(--b-radius)",
        background: "var(--b-bg-prominent)",
        border: "1px dashed var(--b-border-default)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--b-text-muted)",
        fontFamily: "var(--b-font-mono)",
        fontSize: "var(--b-t-label-2)",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      }}
    >
      {label}
    </div>
  );
}
