import { cn } from "@/lib/utils";
import type { PlanBlock, PlanContent } from "@shared/plan-content";
import { CanvasArea } from "./CanvasArea";
import { PlanBlockView } from "./DocumentArea";

type PlanContentRendererProps = {
  content: PlanContent;
  fallbackTitle: string;
  fallbackBrief: string;
  onContentChange?: (content: PlanContent) => Promise<void> | void;
  onVisualQuestionsSubmit?: (summary: string) => void;
};

/**
 * Thin composition shell: the spatial board (CanvasArea) on top when present,
 * the semantic document (DocumentArea blocks) below. All visual quality lives
 * in the area/wireframe modules; this shell only wires data + the document
 * header/scaffold.
 */
export function PlanContentRenderer({
  content,
  fallbackTitle,
  fallbackBrief,
  onContentChange,
  onVisualQuestionsSubmit,
}: PlanContentRendererProps) {
  const planLabel =
    content.canvas?.title === "UI Flow" ? "UI Plan" : "Visual Plan";
  const updateBlock = (id: string, nextBlock: PlanBlock) => {
    const next = {
      ...content,
      blocks: updateBlocks(content.blocks, id, () => nextBlock),
    };
    void onContentChange?.(next);
  };

  return (
    <article className="plan-content-surface min-h-full bg-plan-document text-plan-text">
      {content.canvas && (
        <CanvasArea
          canvas={content.canvas}
          blockLookup={
            new Map(content.blocks.map((block) => [block.id, block]))
          }
        />
      )}
      <div className="mx-auto w-full max-w-[1160px] px-8 py-16 sm:px-12 lg:px-16 lg:py-20">
        <header className="border-b border-plan-line pb-10">
          <p className="mb-7 text-xs font-bold uppercase tracking-[0.16em] text-plan-muted">
            {planLabel}
          </p>
          <h1
            className={cn(
              "max-w-5xl font-semibold leading-[0.98] tracking-[-0.03em]",
              content.blocks.some((block) => block.type === "visual-questions")
                ? "text-4xl sm:text-5xl lg:text-6xl"
                : "text-5xl sm:text-6xl lg:text-7xl",
            )}
          >
            {content.title || fallbackTitle}
          </h1>
          <p className="mt-8 max-w-4xl text-xl leading-8 text-plan-muted sm:text-2xl sm:leading-9">
            {content.brief || fallbackBrief}
          </p>
        </header>

        <div className="plan-document-flow">
          {content.blocks.map((block) => (
            <PlanBlockView
              key={block.id}
              block={block}
              onChange={(nextBlock) => updateBlock(block.id, nextBlock)}
              onVisualQuestionsSubmit={onVisualQuestionsSubmit}
            />
          ))}
        </div>
      </div>
    </article>
  );
}

function updateBlocks(
  blocks: PlanBlock[],
  id: string,
  updater: (block: PlanBlock) => PlanBlock,
): PlanBlock[] {
  return blocks.map((block) => {
    if (block.id === id) return updater(block);
    if (block.type !== "tabs") return block;
    return {
      ...block,
      data: {
        tabs: block.data.tabs.map((tab) => ({
          ...tab,
          blocks: updateBlocks(tab.blocks, id, updater),
        })),
      },
    };
  });
}
