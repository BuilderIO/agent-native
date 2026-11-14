import { useT } from "@agent-native/core/client/i18n";
import { useMermaidRender } from "@agent-native/toolkit/app/blocks";
import {
  NodeViewContent,
  NodeViewWrapper,
  useEditorState,
  type NodeViewProps,
} from "@tiptap/react";
import { useEffect, useId, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** How long typing pauses before the drawing catches up with the source. */
const REDRAW_DELAY_MS = 200;

function useSettledValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

/**
 * A Mermaid code block drawn as its diagram. While the cursor is in the block
 * its source opens above a drawing that follows the typing; the source also
 * stays open when it is empty or can't be drawn, so it is never lost from view.
 */
export function MermaidCodeBlockView({ editor, node, getPos }: NodeViewProps) {
  const t = useT();
  const idSeed = useId();
  const source = node.textContent;
  const drawn = useMermaidRender(
    useSettledValue(source, REDRAW_DELAY_MS),
    idSeed,
  );
  const { editable, editing } = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const { $from, $to } = current.state.selection;
      const pos = getPos();
      const cursorInside =
        typeof pos === "number" &&
        $from.parent.isTextblock &&
        $from.before() === pos &&
        $to.parent === $from.parent;
      return {
        editable: current.isEditable,
        editing: current.isEditable && current.isFocused && cursorInside,
      };
    },
  });

  const empty = source.trim() === "";
  const broken = Boolean(drawn.error) && !drawn.unavailable;
  const sourceShown = editing || empty || broken || Boolean(drawn.unavailable);
  const pending = !empty && !drawn.svg && !drawn.error;

  const openSource = () => {
    const pos = getPos();
    if (typeof pos !== "number") return;
    editor
      .chain()
      .focus()
      .setTextSelection(pos + node.nodeSize - 1)
      .run();
  };

  const closeSource = () => {
    const pos = getPos();
    if (typeof pos !== "number") return;
    editor.chain().focus().setNodeSelection(pos).run();
  };

  const svg = drawn.svg ? (
    <div
      className="content-mermaid__svg"
      dangerouslySetInnerHTML={{ __html: drawn.svg }}
    />
  ) : null;

  return (
    <NodeViewWrapper
      className={cn("content-mermaid", sourceShown && "content-mermaid--open")}
      data-editing={editing || undefined}
    >
      {sourceShown ? (
        <div
          className="content-code-block-header"
          contentEditable={false}
          data-mermaid-control=""
        >
          <span className="content-code-lang-btn content-code-lang-btn--readonly">
            {t("editor.mermaid.source")}
          </span>
          {editing ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  tabIndex={-1}
                  className="content-code-lang-btn"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={closeSource}
                >
                  {t("editor.mermaid.done")}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {t("editor.mermaid.doneShortcut")}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      ) : null}
      <pre hidden={!sourceShown}>
        <NodeViewContent<"code"> as="code" />
      </pre>
      {broken ? (
        <p
          className="content-mermaid__error"
          contentEditable={false}
          role="status"
        >
          {t("editor.mermaid.cantDraw")}: {drawn.error}
        </p>
      ) : null}
      {pending ? (
        <Skeleton
          className="h-32 w-full"
          contentEditable={false}
          data-mermaid-control=""
        />
      ) : svg && editable ? (
        <button
          type="button"
          tabIndex={-1}
          className="content-mermaid__drawing"
          contentEditable={false}
          aria-label={t("editor.mermaid.editDiagram")}
          onMouseDown={(event) => event.preventDefault()}
          onClick={editing ? undefined : openSource}
          data-mermaid-control=""
        >
          {svg}
        </button>
      ) : svg ? (
        <div
          className="content-mermaid__drawing"
          contentEditable={false}
          data-mermaid-control=""
        >
          {svg}
        </div>
      ) : null}
    </NodeViewWrapper>
  );
}
