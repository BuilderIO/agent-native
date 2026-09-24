import { IconPencil } from "@tabler/icons-react";

import { cn } from "../../utils.js";
import { defineBlock } from "../types.js";
import type { BlockReadProps, BlockEditProps } from "../types.js";
import {
  CALLOUT_TONES,
  calloutMdx,
  calloutSchema,
  type CalloutData,
  type CalloutTone,
} from "./callout.config.js";

/**
 * Standard `callout` block — an emphasized note with a tone (info / decision /
 * risk / warning / success) and a markdown body. Lives in core so any app can
 * register it (it originated in the plan template).
 *
 * The section carries BOTH the app-neutral `an-callout` classes (styled by
 * core's `blocks.css` with shadcn theme tokens, so it looks right in any app)
 * and the legacy `plan-callout` classes (styled by the plan template's own
 * stylesheet). Plan therefore renders byte-identically to before; content (and
 * any other app) gets the theme-token treatment. `data-tone` drives the accent
 * in both. The body renders through `ctx.renderMarkdown` so each app supplies
 * its own GFM renderer (plan's react-markdown reader, content's, etc.).
 */
export function CalloutBlock({
  data,
  blockId,
  title,
  ctx,
}: BlockReadProps<CalloutData>) {
  return (
    <section
      className="an-block an-callout plan-block plan-callout"
      data-block-id={blockId}
      data-tone={data.tone}
    >
      {title && <div className="an-block-label plan-block-label">{title}</div>}
      {ctx.renderMarkdown?.(data.body) ?? (
        <div className="an-callout-body whitespace-pre-wrap">{data.body}</div>
      )}
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
                      ? "border-border bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
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
      className="an-block an-callout plan-block plan-callout group/callout relative pr-10"
      data-block-id={blockId}
      data-tone={data.tone}
    >
      {title && <div className="an-block-label plan-block-label">{title}</div>}
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

/** Full client spec for the shared `callout` block (schema + MDX + Read/Edit). */
export const calloutBlock = defineBlock<CalloutData>({
  type: "callout",
  schema: calloutSchema,
  mdx: calloutMdx,
  Read: CalloutBlock,
  Edit: CalloutBlockEdit,
  placement: ["block"],
  editSurface: "inline",
  label: "Callout",
  description:
    "An emphasized note with a tone (info/decision/risk/warning/success) and a markdown body.",
  // `body` is a `markdown(min(1))` field, so a fresh callout needs non-empty
  // placeholder prose; `tone` defaults to the neutral "info" register.
  empty: () => ({ tone: "info", body: "Callout text" }),
});
