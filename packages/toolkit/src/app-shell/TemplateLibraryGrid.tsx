import {
  ActionButton,
  Skeleton,
  Spinner,
  Surface,
} from "@agent-native/toolkit/design-system";
import { useId, useRef, type ReactElement, type ReactNode } from "react";

export interface TemplateLibraryItem {
  id: string;
  title: string;
  description?: string | null;
  disabled?: boolean;
}

type TemplateLibraryActivation<T extends TemplateLibraryItem> =
  | {
      onSelect: (item: T, element: HTMLElement) => void;
      renderLink?: never;
    }
  | {
      renderLink: (item: T, children: ReactNode) => ReactElement;
      onSelect?: never;
    };

export type TemplateLibraryCardProps<T extends TemplateLibraryItem> = {
  item: T;
  preview: ReactNode;
  actions?: ReactNode;
  metadata?: ReactNode;
  actionsVisible?: boolean;
  selected?: boolean;
  pending?: boolean;
  pendingLabel?: string;
  disabled?: boolean;
} & TemplateLibraryActivation<T>;

export function TemplateLibraryCard<T extends TemplateLibraryItem>({
  item,
  preview,
  actions,
  metadata,
  actionsVisible = false,
  selected = false,
  pending = false,
  pendingLabel,
  disabled = false,
  onSelect,
  renderLink,
}: TemplateLibraryCardProps<T>) {
  const titleId = useId();
  const container = useRef<HTMLDivElement>(null);
  const unavailable = disabled || item.disabled || pending;
  const card = (
    <Surface
      padding="none"
      elevation="none"
      interactive={Boolean(onSelect) && !unavailable}
      aria-labelledby={titleId}
      aria-pressed={onSelect && !unavailable ? selected : undefined}
      onPress={
        onSelect && !unavailable
          ? (event) => {
              const element = event?.currentTarget ?? container.current;
              if (element) onSelect(item, element);
            }
          : undefined
      }
    >
      <Surface padding="none">
        <div className="agent-template-library-preview">{preview}</div>
      </Surface>
      <div className="agent-template-library-caption grid content-start gap-1">
        <h3 id={titleId} className="truncate text-sm font-medium">
          {item.title}
        </h3>
        {item.description ? (
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {item.description}
          </p>
        ) : null}
        {metadata ? (
          <div className="min-w-0 text-xs text-muted-foreground">
            {metadata}
          </div>
        ) : null}
      </div>
    </Surface>
  );
  return (
    <div
      ref={container}
      className="agent-template-library-card relative min-w-0"
      data-selected={selected || undefined}
      aria-busy={pending || undefined}
    >
      <div
        className="agent-template-library-primary"
        role={unavailable ? (renderLink ? "link" : "button") : undefined}
        aria-pressed={unavailable && onSelect ? selected : undefined}
        aria-disabled={unavailable || undefined}
      >
        {renderLink && !unavailable ? renderLink(item, card) : card}
        {pending && pendingLabel ? (
          <div
            role="status"
            className="absolute inset-0 z-20 flex items-center justify-center gap-2 rounded-xl bg-background/80 p-4 text-sm font-medium text-foreground backdrop-blur-sm"
          >
            <Spinner className="size-4" />
            {pendingLabel}
          </div>
        ) : null}
      </div>
      {actions ? (
        <div
          className={`agent-template-library-actions flex items-center gap-2 pt-3${
            actionsVisible ? " !opacity-100" : ""
          }`}
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export type TemplateLibraryGridProps<T extends TemplateLibraryItem> = {
  items: readonly T[];
  renderPreview: (item: T) => ReactNode;
  renderActions?: (item: T) => ReactNode;
  renderMetadata?: (item: T) => ReactNode;
  actionsVisible?: (item: T) => boolean;
  isSelected?: (item: T) => boolean;
  selectedId?: string | null;
  pendingId?: string | null;
  pendingLabel?: string;
  disabled?: boolean;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  labels: { loading: string; empty: string; retry: string };
  empty?: ReactNode;
} & TemplateLibraryActivation<T>;

export function TemplateLibraryGrid<T extends TemplateLibraryItem>({
  items,
  renderPreview,
  renderActions,
  renderMetadata,
  actionsVisible,
  isSelected,
  selectedId,
  pendingId,
  pendingLabel,
  disabled,
  loading = false,
  error,
  onRetry,
  labels,
  empty,
  onSelect,
  renderLink,
}: TemplateLibraryGridProps<T>) {
  return (
    <div className="grid gap-4" aria-busy={loading || undefined}>
      {error ? (
        <div className="flex flex-wrap items-center gap-3" role="alert">
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
      ) : null}
      {items.length ? (
        <div className="agent-template-library-grid">
          {items.map((item) => (
            <TemplateLibraryCard
              key={item.id}
              item={item}
              preview={renderPreview(item)}
              actions={renderActions?.(item)}
              metadata={renderMetadata?.(item)}
              actionsVisible={actionsVisible?.(item)}
              selected={isSelected?.(item) ?? item.id === selectedId}
              pending={item.id === pendingId}
              pendingLabel={pendingLabel}
              disabled={disabled}
              {...(renderLink ? { renderLink } : { onSelect: onSelect! })}
            />
          ))}
        </div>
      ) : error ? null : loading ? (
        <div
          className="agent-template-library-grid"
          role="status"
          aria-label={labels.loading}
        >
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index}>
              <Surface padding="none">
                <div className="agent-template-library-preview">
                  <Skeleton shape="rectangle" width="100%" height="100%" />
                </div>
              </Surface>
              <div className="pt-3">
                <Skeleton width="70%" height="1.25rem" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div
          role="status"
          className="py-8 text-center text-sm text-muted-foreground"
        >
          {empty ?? labels.empty}
        </div>
      )}
    </div>
  );
}
