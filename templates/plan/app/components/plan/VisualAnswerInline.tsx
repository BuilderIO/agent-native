import { IconArrowUpRight, IconLayoutDashboard } from "@tabler/icons-react";
import type { ToolRendererProps } from "@agent-native/core/client";
import { BlockRegistryProvider } from "@agent-native/core/blocks";
import type { PlanBlock, PlanContent } from "@shared/plan-content";
import { cn } from "@/lib/utils";
import { PlanBlockView } from "./DocumentArea";
import { createPlanBlockRenderContext, planBlockRegistry } from "./planBlocks";

type VisualAnswerResult = {
  planId?: string;
  url?: string;
  question?: string;
  plan?: {
    id?: string;
    kind?: string;
    title?: string;
    brief?: string;
    content?: PlanContent | null;
  } | null;
};

function asResult(value: unknown): VisualAnswerResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as VisualAnswerResult;
}

function blocksOf(content: PlanContent | null | undefined): PlanBlock[] {
  return Array.isArray(content?.blocks) ? content!.blocks : [];
}

/**
 * Inline chat renderer for the `visual-answer` action (and any action that
 * returns `{ plan: { content } }` keyed to the `plan.visual-answer` renderer).
 * Renders the published visual answer's diagram/wireframe/api-spec/data-model/
 * etc. blocks read-only, INSIDE the conversation, registry-driven so custom
 * registered plan blocks render here too. The full editable surface stays one
 * click away via the deep link.
 */
export default function VisualAnswerInline({ context }: ToolRendererProps) {
  // While the tool is still running there is no result yet — let the default
  // running pill show instead of an empty card.
  if (context.isRunning) return null;

  const result = asResult(context.resultJson);
  const plan = result?.plan ?? null;
  const content = plan?.content ?? null;
  const blocks = blocksOf(content);
  const url = result?.url;
  const heading =
    plan?.title?.trim() || content?.title?.trim() || "Visual answer";
  const brief = plan?.brief?.trim() || content?.brief?.trim() || "";

  // Nothing renderable (older result shape or a publish-only fallback): defer to
  // the action's link affordance rather than showing a broken empty card.
  if (blocks.length === 0) return null;

  const ctx = createPlanBlockRenderContext({ editingDisabled: true });

  return (
    <div className="my-1 overflow-hidden rounded-lg border bg-card text-card-foreground">
      <div className="flex items-start justify-between gap-3 border-b px-3.5 py-2.5">
        <div className="flex min-w-0 items-start gap-2.5">
          <IconLayoutDashboard className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium leading-snug">
              {heading}
            </div>
            {brief && (
              <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                {brief}
              </div>
            )}
          </div>
        </div>
        {url && (
          <a
            href={url}
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium",
              "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            Open
            <IconArrowUpRight className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
      <div className="plan-chat-visual-answer max-h-[520px] overflow-y-auto px-3.5 py-3">
        <BlockRegistryProvider registry={planBlockRegistry} ctx={ctx}>
          <div className="grid gap-4">
            {blocks.map((block) => (
              <PlanBlockView
                key={block.id}
                block={block}
                editingDisabled
                compactVisuals
              />
            ))}
          </div>
        </BlockRegistryProvider>
      </div>
    </div>
  );
}
