type SidebarLoadErrorProps = {
  message: string;
  retryLabel: string;
  onRetry: () => void;
};

export function SidebarLoadError({
  message,
  retryLabel,
  onRetry,
}: SidebarLoadErrorProps) {
  return (
    <div className="px-3 py-1 text-[11px] text-destructive" role="status">
      <span>{message}</span>{" "}
      <button
        type="button"
        className="font-medium underline underline-offset-2 hover:text-destructive/80"
        onClick={onRetry}
      >
        {retryLabel}
      </button>
    </div>
  );
}
