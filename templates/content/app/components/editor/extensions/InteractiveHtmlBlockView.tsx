import { useT } from "@agent-native/core/client/i18n";
import { writeClipboardText } from "@agent-native/toolkit/clipboard";
import { interactiveHtmlTitle } from "@shared/interactive-html";
import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconCode,
  IconCopy,
  IconLink,
  IconPlayerPlay,
  type Icon,
} from "@tabler/icons-react";
import {
  NodeViewContent,
  NodeViewWrapper,
  useEditorState,
  type NodeViewProps,
} from "@tiptap/react";
import {
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { InteractiveHtmlContext } from "../interactive-html/interactive-html-context";
import { SealedFrame } from "../interactive-html/SealedFrame";
import { useSettledValue, useSourceCursor } from "./source-block";
import { suggestionHighlightKey } from "./SuggestionHighlight";

const RERUN_DELAY_MS = 600;

function ControlButton({
  label,
  icon: IconComponent,
  pressed,
  onClick,
}: {
  label: string;
  icon: Icon;
  pressed?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          aria-pressed={pressed}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onClick}
        >
          <IconComponent />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function InteractiveHtmlBlockView({
  editor,
  node,
  getPos,
  selected,
}: NodeViewProps) {
  const t = useT();
  const titleId = useId();
  const { runsOnOpen, fullScreenPos, onFullScreenClosed, copyLink } =
    useContext(InteractiveHtmlContext);
  const source = node.textContent;
  const running = useSettledValue(source, RERUN_DELAY_MS);
  const { editable, editing, cursorInside } = useSourceCursor(editor, getPos);
  const suggested = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const pos = getPos();
      if (typeof pos !== "number") return false;
      const specs = suggestionHighlightKey.getState(current.state)?.specs ?? [];
      const end = pos + node.nodeSize;
      return specs.some((spec) => spec.from < end && spec.to > pos);
    },
  });
  const [started, setStarted] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [cursorEntered, setCursorEntered] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const [wasSelected, setWasSelected] = useState(selected);
  const [openedPos, setOpenedPos] = useState<number | null>(null);
  const [openedByLink, setOpenedByLink] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const empty = source.trim() === "";
  const runs = !empty && (runsOnOpen || started);
  const title =
    interactiveHtmlTitle(source) ?? t("editor.interactiveHtml.untitled");
  const sourceShown =
    !fullScreen && (sourceOpen || cursorEntered || empty || suggested);

  if (editing && !cursorEntered) setCursorEntered(true);
  if (!cursorInside && cursorEntered) setCursorEntered(false);
  if (selected !== wasSelected) {
    setWasSelected(selected);
    if (selected) setSourceOpen(false);
  }
  if (fullScreenPos !== openedPos) {
    const opens = fullScreenPos !== null && getPos() === fullScreenPos;
    setOpenedPos(fullScreenPos);
    setOpenedByLink(opens);
    if (opens || openedByLink) setFullScreen(opens);
  }

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open === fullScreen) return;
    if (!fullScreen) {
      dialog.close();
      return;
    }
    dialog.showModal();
  }, [fullScreen]);

  const leaveFullScreen = () => {
    if (!fullScreen) return;
    setFullScreen(false);
    onFullScreenClosed();
  };

  const select = () => {
    const pos = getPos();
    if (typeof pos === "number") {
      editor.chain().focus().setNodeSelection(pos).run();
    }
  };

  const toggleSource = () => {
    const pos = getPos();
    if (sourceShown) {
      setSourceOpen(false);
      if (cursorEntered) select();
      return;
    }
    setSourceOpen(true);
    if (editable && typeof pos === "number") {
      editor
        .chain()
        .focus()
        .setTextSelection(pos + node.nodeSize - 1)
        .run();
    }
  };

  const copySource = async () => {
    if (await writeClipboardText(source)) {
      toast.success(t("editor.interactiveHtml.copied"));
    } else {
      toast.error(t("editor.interactiveHtml.copyFailed"));
    }
  };

  const copyOwnLink = () => {
    const pos = getPos();
    if (typeof pos === "number") copyLink?.(pos);
  };

  return (
    <NodeViewWrapper
      as="dialog"
      ref={dialogRef}
      role={fullScreen ? "dialog" : "figure"}
      aria-labelledby={titleId}
      className={cn(
        "content-interactive-html",
        fullScreen && "content-interactive-html--full",
      )}
      onClose={leaveFullScreen}
      onKeyDown={(event: KeyboardEvent) => {
        if (fullScreen) event.stopPropagation();
      }}
    >
      <div
        className="content-interactive-html__header"
        contentEditable={false}
        data-interactive-html-control=""
      >
        <div
          id={titleId}
          className="content-interactive-html__title"
          onClick={select}
        >
          {title}
        </div>
        {fullScreen ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={leaveFullScreen}
          >
            <IconArrowsMinimize />
            {t("editor.interactiveHtml.closeFullScreen")}
          </Button>
        ) : empty ? null : (
          <div className="flex shrink-0 items-center gap-0.5">
            <ControlButton
              label={t(
                sourceShown
                  ? "editor.interactiveHtml.hideSource"
                  : "editor.interactiveHtml.showSource",
              )}
              icon={IconCode}
              pressed={sourceShown}
              onClick={toggleSource}
            />
            <ControlButton
              label={t("editor.interactiveHtml.copyHtml")}
              icon={IconCopy}
              onClick={() => void copySource()}
            />
            {copyLink ? (
              <ControlButton
                label={t("editor.interactiveHtml.copyLink")}
                icon={IconLink}
                onClick={copyOwnLink}
              />
            ) : null}
            <ControlButton
              label={t("editor.interactiveHtml.fullScreen")}
              icon={IconArrowsMaximize}
              onClick={() => setFullScreen(true)}
            />
          </div>
        )}
      </div>
      <pre hidden={!sourceShown}>
        <NodeViewContent<"code"> as="code" />
      </pre>
      {empty ? null : (
        <div
          className="content-interactive-html__body"
          contentEditable={false}
          data-interactive-html-control=""
        >
          {runs ? (
            <SealedFrame
              source={running}
              title={title}
              fullScreen={fullScreen}
              onEscape={leaveFullScreen}
            />
          ) : (
            <div className="content-interactive-html__waiting">
              <p>{t("editor.interactiveHtml.runHint")}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setStarted(true)}
              >
                <IconPlayerPlay />
                {t("editor.interactiveHtml.run")}
              </Button>
            </div>
          )}
        </div>
      )}
    </NodeViewWrapper>
  );
}
