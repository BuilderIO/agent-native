import { Button } from "@/components/ui/button";

type ResourceLoadErrorProps = {
  message: string;
  retryLabel: string;
  onRetry: () => void;
  inline?: boolean;
};

export function ResourceLoadError({
  message,
  retryLabel,
  onRetry,
  inline = false,
}: ResourceLoadErrorProps) {
  if (inline) {
    return (
      <div className="px-2 py-2 text-xs text-destructive" role="status">
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

  return (
    <div
      className="flex h-64 flex-col items-center justify-center gap-2 text-sm text-destructive"
      role="status"
    >
      <span>{message}</span>
      <Button size="sm" variant="outline" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  );
}
