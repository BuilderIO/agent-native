import {
  ActionButton,
  Dialog,
  Skeleton,
  Surface,
} from "@agent-native/toolkit/design-system";
import {
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

export interface TemplatePreviewThumbnail {
  id: string;
  title: string;
  preview: ReactNode;
  disabled?: boolean;
}

export type TemplatePreviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  children: ReactNode;
  size?: "large" | "viewport";
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  empty?: boolean;
  labels: {
    close: string;
    loading: string;
    empty: string;
    retry: string;
    thumbnails: string;
  };
  initialFocusRef?: RefObject<HTMLElement | null>;
  restoreFocusRef?: RefObject<HTMLElement | null>;
} & (
  | {
      thumbnails: readonly TemplatePreviewThumbnail[];
      selectedId: string;
      onSelectedIdChange: (id: string) => void;
    }
  | { thumbnails?: never; selectedId?: never; onSelectedIdChange?: never }
);

export function TemplatePreviewDialog({
  open,
  onOpenChange,
  title,
  children,
  size = "viewport",
  loading = false,
  error,
  onRetry,
  empty = false,
  labels,
  thumbnails,
  selectedId,
  onSelectedIdChange,
  initialFocusRef,
  restoreFocusRef,
}: TemplatePreviewDialogProps) {
  const thumbnailElements = useRef(new Map<string, HTMLDivElement>());
  const ready = !loading && !error && !empty;
  const onRailKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target;
    if (
      !(target instanceof HTMLElement) ||
      !target.closest('button, [role="button"]')
    )
      return;
    const enabled = thumbnails?.filter((item) => !item.disabled) ?? [];
    if (!enabled.length) return;
    const currentId = target.closest<HTMLElement>(
      "[data-template-preview-thumbnail]",
    )?.dataset.templatePreviewThumbnail;
    const index = enabled.findIndex((item) => item.id === currentId);
    if (index < 0) return;
    const offset = ["ArrowRight", "ArrowDown"].includes(event.key)
      ? 1
      : ["ArrowLeft", "ArrowUp"].includes(event.key)
        ? -1
        : 0;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? enabled.length - 1
          : offset
            ? (index + offset + enabled.length) % enabled.length
            : -1;
    if (next < 0) return;
    event.preventDefault();
    const item = enabled[next]!;
    onSelectedIdChange?.(item.id);
    thumbnailElements.current
      .get(item.id)
      ?.querySelector<HTMLElement>('button, [role="button"]')
      ?.focus();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size={size}
      className="agent-template-preview-dialog"
      closeLabel={labels.close}
      initialFocusRef={initialFocusRef}
      restoreFocusRef={restoreFocusRef}
    >
      <div
        className="agent-template-preview-viewer"
        data-size={size}
        data-has-rail={(ready && Boolean(thumbnails?.length)) || undefined}
        aria-busy={loading || undefined}
      >
        {ready && thumbnails?.length ? (
          <nav
            className="agent-template-preview-rail"
            aria-label={labels.thumbnails}
            onKeyDown={onRailKeyDown}
          >
            {thumbnails.map((item) => (
              <div
                key={item.id}
                className="agent-template-preview-thumbnail"
                data-template-preview-thumbnail={item.id}
                data-selected={item.id === selectedId || undefined}
                role={item.disabled ? "button" : undefined}
                aria-label={item.disabled ? item.title : undefined}
                aria-disabled={item.disabled || undefined}
                ref={(element) => {
                  if (element) thumbnailElements.current.set(item.id, element);
                  else thumbnailElements.current.delete(item.id);
                }}
              >
                <Surface
                  padding="compact"
                  interactive={!item.disabled}
                  aria-label={item.title}
                  aria-pressed={
                    !item.disabled ? item.id === selectedId : undefined
                  }
                  onPress={
                    item.disabled
                      ? undefined
                      : () => onSelectedIdChange?.(item.id)
                  }
                >
                  <div className="agent-template-library-preview" inert>
                    {item.preview}
                  </div>
                  <div className="truncate pt-2 text-sm">{item.title}</div>
                </Surface>
              </div>
            ))}
          </nav>
        ) : null}
        <div className="agent-template-preview-content">
          {error ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-center gap-3 p-6"
            >
              <span className="text-sm text-destructive">{error}</span>
              {onRetry ? (
                <ActionButton
                  emphasis="outline"
                  disabled={loading}
                  onPress={onRetry}
                >
                  {labels.retry}
                </ActionButton>
              ) : null}
            </div>
          ) : loading ? (
            <div
              role="status"
              aria-label={labels.loading}
              className="h-full p-4"
            >
              <Skeleton shape="rectangle" width="100%" height="100%" />
            </div>
          ) : empty ? (
            <div
              role="status"
              className="p-6 text-center text-sm text-muted-foreground"
            >
              {labels.empty}
            </div>
          ) : (
            children
          )}
        </div>
      </div>
    </Dialog>
  );
}
