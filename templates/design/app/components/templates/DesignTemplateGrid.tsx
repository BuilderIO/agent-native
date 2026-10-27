import { Spinner } from "@agent-native/toolkit/design-system";
import { useId, type ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";

import type { DesignLibraryTemplate } from "./DesignTemplateLibrary";
import { TemplatePreview } from "./TemplatePreview";

const GRID_CLASS =
  "grid gap-x-4 gap-y-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,15rem),1fr))]";

export const TEMPLATE_GRID_SKELETON_COUNT = 8;

export function DesignTemplateGrid({
  templates,
  loading,
  pendingId,
  pendingLabel,
  disabled,
  selectedId,
  loadingLabel,
  emptyLabel,
  onSelect,
  renderActions,
}: {
  templates: readonly DesignLibraryTemplate[];
  loading: boolean;
  pendingId: string | null;
  pendingLabel: string;
  disabled: boolean;
  selectedId?: string;
  loadingLabel: string;
  emptyLabel: string;
  onSelect: (template: DesignLibraryTemplate, element: HTMLElement) => void;
  renderActions?: (template: DesignLibraryTemplate) => ReactNode;
}) {
  if (templates.length === 0) {
    return loading ? (
      <div
        className={GRID_CLASS}
        role="status"
        aria-label={loadingLabel}
        aria-busy="true"
      >
        {Array.from({ length: TEMPLATE_GRID_SKELETON_COUNT }, (_, index) => (
          <div
            key={index}
            className="overflow-hidden rounded-[10px] border border-border"
          >
            <Skeleton className="aspect-[2/1] w-full rounded-none" />
            <div className="grid gap-1 px-3.5 py-[13px]">
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-3.5 w-4/5" />
            </div>
          </div>
        ))}
      </div>
    ) : (
      <div
        role="status"
        className="py-8 text-center text-sm text-muted-foreground"
      >
        {emptyLabel}
      </div>
    );
  }
  return (
    <ul className={GRID_CLASS} aria-busy={loading || undefined}>
      {templates.map((template) => (
        <DesignTemplateCard
          key={template.id}
          template={template}
          pending={template.id === pendingId}
          pendingLabel={pendingLabel}
          disabled={disabled}
          selected={template.id === selectedId}
          onSelect={onSelect}
          actions={renderActions?.(template)}
        />
      ))}
    </ul>
  );
}

function DesignTemplateCard({
  template,
  pending,
  pendingLabel,
  disabled,
  selected,
  onSelect,
  actions,
}: {
  template: DesignLibraryTemplate;
  pending: boolean;
  pendingLabel: string;
  disabled: boolean;
  selected: boolean;
  onSelect: (template: DesignLibraryTemplate, element: HTMLElement) => void;
  actions?: ReactNode;
}) {
  const titleId = useId();
  const descriptionId = useId();
  return (
    <li
      className="group/card relative min-w-0"
      aria-busy={pending || undefined}
    >
      <button
        type="button"
        aria-labelledby={titleId}
        aria-describedby={template.description ? descriptionId : undefined}
        aria-pressed={selected}
        aria-disabled={disabled || undefined}
        onClick={(event) => {
          if (!disabled) onSelect(template, event.currentTarget);
        }}
        className="block w-full overflow-hidden rounded-[10px] border border-border bg-background text-left transition-colors outline-none hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-foreground/40 aria-disabled:cursor-default"
      >
        <span className="relative block aspect-[2/1] overflow-hidden bg-muted">
          <TemplatePreview
            html={template.previewHtml}
            title={template.title}
            width={template.width}
            height={template.height}
            fit="cover"
            className="absolute inset-0 h-full w-full"
          />
        </span>
        <span className="block px-3.5 py-[13px]">
          <span
            id={titleId}
            className="block truncate text-[13px] leading-4 font-semibold text-foreground"
          >
            {template.title}
          </span>
          {template.description ? (
            <span
              id={descriptionId}
              className="mt-1 block truncate text-[11px] leading-3.5 text-muted-foreground"
            >
              {template.description}
            </span>
          ) : null}
        </span>
      </button>
      {actions ? (
        <div className="absolute top-2 right-2 z-10 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within/card:opacity-100 [@media(hover:hover)]:group-hover/card:opacity-100">
          {actions}
        </div>
      ) : null}
      {pending ? (
        <div
          role="status"
          className="absolute inset-0 z-20 flex items-center justify-center gap-2 rounded-[10px] bg-background/80 p-4 text-sm font-medium text-foreground backdrop-blur-sm"
        >
          <Spinner className="size-4" />
          {pendingLabel}
        </div>
      ) : null}
    </li>
  );
}
