import { useT } from "@agent-native/core/client/i18n";
import { IconChevronDown } from "@tabler/icons-react";
import { useState } from "react";

import { type PromptTemplateOption } from "@/components/editor/design-start-pickers";
import { TemplatePreview } from "@/components/templates/TemplatePreview";
import { Skeleton } from "@/components/ui/skeleton";

const COLLAPSED_COUNT = 3;

/** Its shape is what you pick a starting point by; the category is a raw slug. */
function subtitleFor(template: PromptTemplateOption): string | null {
  if (template.width && template.height) {
    return `${template.width} × ${template.height}`;
  }
  return template.category ?? null;
}

export interface FirstRunStartProps {
  templates: PromptTemplateOption[];
  templatesLoading: boolean;
  applyingTemplateId: string | null;
  onPickTemplate: (templateId: string) => void;
}

/**
 * The empty-design starting point, in the agent rail rather than over the
 * canvas: choosing one is the first turn of the conversation, and the board
 * and tools stay usable behind it for anyone who would rather just draw.
 * Cards, not a dropdown — a template applies on click, so the row is the
 * action rather than a value you set and then submit.
 */
export function FirstRunStart({
  templates,
  templatesLoading,
  applyingTemplateId,
  onPickTemplate,
}: FirstRunStartProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const busy = applyingTemplateId !== null;
  const shown = expanded ? templates : templates.slice(0, COLLAPSED_COUNT);
  const hasMore = templates.length > COLLAPSED_COUNT;

  return (
    <div
      data-design-first-run
      className="mx-auto flex w-full max-w-[260px] flex-col gap-2 pt-1"
      aria-busy={busy}
    >
      {templatesLoading
        ? Array.from({ length: COLLAPSED_COUNT }).map((_, index) => (
            <Skeleton key={index} className="h-14 w-full rounded-lg" />
          ))
        : shown.map((template) => (
            <button
              key={template.id}
              type="button"
              disabled={busy}
              data-template-card={template.id}
              onClick={() => onPickTemplate(template.id)}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-background px-2.5 py-2 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <TemplatePreview
                html={template.previewHtml}
                title={template.title}
                width={template.width}
                height={template.height}
                className="h-9 w-12 shrink-0 rounded-md border bg-muted/40"
              />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] text-foreground">
                  {template.title}
                </span>
                {subtitleFor(template) ? (
                  <span className="truncate text-[11px] text-muted-foreground">
                    {subtitleFor(template)}
                  </span>
                ) : null}
              </span>
            </button>
          ))}
      {hasMore ? (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          disabled={busy}
          className="flex cursor-pointer items-center justify-center gap-1 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          aria-expanded={expanded}
        >
          {t("templatesPage.title")}
          <IconChevronDown
            className={`size-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </button>
      ) : null}
    </div>
  );
}
