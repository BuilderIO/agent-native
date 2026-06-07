import type { BlockEditProps, BlockReadProps } from "@agent-native/core/blocks";
import {
  CALLOUT_TONES,
  type CalloutData,
  type CalloutTone,
} from "@shared/blocks/callout.config";
import { IconPencil } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { PlanMarkdownReader } from "../PlanMarkdownReader";

/**
 * Read-only renderer for a `callout` block. Mirrors the legacy `PlanBlockView`
 * callout branch byte-for-byte (same `plan-block plan-callout` section + title +
 * `PlanMarkdownReader` body) so converting the block to the registry does not
 * change the rendered output. A `data-tone` attribute is set when a tone is
 * present so future tone styling can hook in without touching the markup.
 */
export function CalloutBlock({
  data,
  blockId,
  title,
}: BlockReadProps<CalloutData>) {
  return (
    <section
      className="plan-block plan-callout"
      data-block-id={blockId}
      data-tone={data.tone}
    >
      {title && <div className="plan-block-label">{title}</div>}
      <PlanMarkdownReader markdown={data.body} />
    </section>
  );
}

export function CalloutBlockEdit({
  data,
  onChange,
  editable,
  blockId,
  title,
  summary,
  ctx,
}: BlockEditProps<CalloutData>) {
  const activeTone = data.tone ?? "info";
  const setTone = (tone: CalloutTone) => onChange({ ...data, tone });
  const toneSettings = editable
    ? ctx.renderEditSurface?.({
        title: "Callout",
        blockId,
        blockType: "callout",
        blockTitle: title,
        blockSummary: summary,
        blockData: data,
        trigger: (
          <button
            type="button"
            data-plan-interactive
            aria-label="Edit callout type"
            className="an-block-edit-trigger flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-[color,opacity] hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover/callout:opacity-100"
          >
            <IconPencil className="size-4" />
          </button>
        ),
        children: (
          <div className="grid gap-2">
            <div className="text-xs font-medium text-muted-foreground">
              Type
            </div>
            <div className="flex max-w-full flex-wrap items-center gap-1">
              {CALLOUT_TONES.map((tone) => (
                <button
                  key={tone}
                  type="button"
                  className={cn(
                    "rounded-md border border-transparent px-2 py-1 text-xs font-semibold capitalize transition-colors",
                    activeTone === tone
                      ? "border-plan-line bg-plan-block/70 text-plan-text"
                      : "text-plan-muted hover:bg-plan-block/70 hover:text-plan-text",
                  )}
                  aria-pressed={activeTone === tone}
                  onClick={() => setTone(tone)}
                >
                  {tone}
                </button>
              ))}
            </div>
          </div>
        ),
      })
    : null;

  return (
    <section
      className="plan-block plan-callout group/callout relative pr-10"
      data-block-id={blockId}
      data-tone={data.tone}
    >
      {title && <div className="plan-block-label">{title}</div>}
      {toneSettings && (
        <div className="absolute right-2 top-2 z-10">{toneSettings}</div>
      )}
      {ctx.renderMarkdownEditor?.({
        value: data.body,
        onChange: (body) => onChange({ ...data, body }),
        editable,
        blockId,
      }) ?? (
        <textarea
          data-plan-interactive
          className="min-h-[120px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm leading-6 text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={data.body}
          disabled={!editable}
          onChange={(event) =>
            onChange({ ...data, body: event.currentTarget.value })
          }
        />
      )}
    </section>
  );
}
