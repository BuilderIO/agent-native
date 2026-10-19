import type { CodeLayerNode } from "@shared/code-layer";
import type { MotionLayerCodeSource } from "@shared/motion-layer-code";
import { IconCheck, IconCopy, IconTimeline } from "@tabler/icons-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  buildMotionCodeModel,
  type MotionCodeLayer,
  type MotionCodeModel,
} from "@/pages/design-editor/motion-code-model";

// A section longer than this shows its first lines and a control to reveal the rest.
const COLLAPSED_LINE_COUNT = 8;

type MotionCodeFormat = "css" | "data";

export interface MotionCodeInput {
  source: MotionLayerCodeSource;
  nodes: readonly Pick<
    CodeLayerNode,
    "id" | "layerName" | "children" | "dataAttributes" | "style"
  >[];
  targets: readonly { nodeId: string; label: string }[];
  onHoverLayer?: (layerId: string) => void;
  onOpenInTimeline?: () => void;
}

interface MotionCodeViewProps {
  input: MotionCodeInput | undefined;
  /** The editable motion rows, shown in the list view. */
  list: ReactNode;
  hasList: boolean;
  t: (key: string) => string;
}

type ModelResult = { model: MotionCodeModel } | { failed: true };

export function MotionCodeView({ input, list, ...props }: MotionCodeViewProps) {
  if (!input) return <>{list}</>;
  return <MotionCodeViewBody input={input} list={list} {...props} />;
}

function MotionCodeViewBody({
  input,
  list,
  hasList,
  t,
}: MotionCodeViewProps & { input: MotionCodeInput }) {
  const [view, setView] = useState<"list" | "code">("code");
  const [format, setFormat] = useState<MotionCodeFormat>("css");
  const { source, nodes, targets } = input;
  const targetKey = targets
    .map((target) => `${target.nodeId}\u001f${target.label}`)
    .join("\u001e");
  const result = useMemo<ModelResult>(() => {
    try {
      return { model: buildMotionCodeModel({ source, nodes, targets }) };
    } catch {
      return { failed: true };
    }
    // `targets` is rebuilt every render; `targetKey` stands for its content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    source.tracks,
    source.nativeStyles,
    source.textAnimations,
    source.durationMs,
    source.defaultEase,
    source.playbackMode,
    source.easingVariables,
    nodes,
    targetKey,
  ]);

  const codeAvailable = "failed" in result || result.model.animatedCount > 0;
  if (!hasList && !codeAvailable) return <>{list}</>;
  const activeView = !codeAvailable ? "list" : hasList ? view : "code";

  return (
    <div className="space-y-2">
      <Tabs
        value={activeView}
        onValueChange={(value) => setView(value as "list" | "code")}
      >
        <TabsList className="h-7 w-full justify-start gap-0.5 rounded-md bg-[var(--design-editor-control-bg)] p-0.5">
          <ViewTab
            value="list"
            disabled={!hasList}
            hint={t("designEditor.motion.code.nothingToList")}
            label={t("designEditor.motion.code.list")}
          />
          <ViewTab
            value="code"
            disabled={!codeAvailable}
            hint={t("designEditor.motion.code.nothingToShow")}
            label={t("designEditor.motion.code.code")}
          />
        </TabsList>
      </Tabs>
      {activeView === "list" ? (
        list
      ) : "failed" in result ? (
        <p className="px-1 text-[11px] text-muted-foreground">
          {t("designEditor.motion.code.unavailable")}
        </p>
      ) : (
        <div className="space-y-2">
          <Select
            value={format}
            onValueChange={(value) => setFormat(value as MotionCodeFormat)}
          >
            <SelectTrigger
              className="h-7 text-[11px]"
              aria-label={t("designEditor.motion.code.format")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="css">
                {t("designEditor.motion.code.css")}
              </SelectItem>
              <SelectItem value="data">
                {t("designEditor.motion.code.data")}
              </SelectItem>
            </SelectContent>
          </Select>
          {format === "css" ? (
            <CssCode model={result.model} input={input} t={t} />
          ) : (
            <CodeSection text={result.model.data} t={t} />
          )}
        </div>
      )}
    </div>
  );
}

function ViewTab({
  value,
  disabled,
  hint,
  label,
}: {
  value: string;
  disabled: boolean;
  hint?: string;
  label: string;
}) {
  const trigger = (
    <TabsTrigger
      value={value}
      disabled={disabled}
      className="h-6 min-w-0 flex-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground shadow-none transition-colors hover:text-foreground data-[state=active]:bg-[var(--design-editor-panel-bg)] data-[state=active]:text-[var(--design-editor-accent-color)] data-[state=active]:shadow-[inset_0_0_0_1px_var(--design-editor-control-border)]"
    >
      {label}
    </TabsTrigger>
  );
  if (!disabled || !hint) return trigger;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex min-w-0 flex-1">{trigger}</span>
      </TooltipTrigger>
      <TooltipContent side="top">{hint}</TooltipContent>
    </Tooltip>
  );
}

function CssCode({
  model,
  input,
  t,
}: {
  model: MotionCodeModel;
  input: MotionCodeInput;
  t: (key: string) => string;
}) {
  const allText = model.layers
    .flatMap((layer) => (layer.css ? [layer.css.styles, layer.css.steps] : []))
    .join("\n\n");
  return (
    <div className="space-y-3">
      {model.layers.map((layer) => (
        <div key={layer.nodeId} className="space-y-1.5">
          <LayerHeader layer={layer} input={input} t={t} />
          {layer.css ? (
            <>
              <CodeSection
                title={t("designEditor.motion.code.styles")}
                text={layer.css.styles}
                allText={allText}
                t={t}
              />
              <CodeSection
                title={t("designEditor.motion.code.keyframes")}
                text={layer.css.steps}
                allText={allText}
                t={t}
              />
            </>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function LayerHeader({
  layer,
  input,
  t,
}: {
  layer: MotionCodeLayer;
  input: MotionCodeInput;
  t: (key: string) => string;
}) {
  if (layer.css) {
    return (
      <div className="flex items-center justify-between gap-1">
        <span className="min-w-0 truncate text-[11px] font-medium">
          {layer.label}
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="size-6 shrink-0 px-0"
          aria-label={t("designEditor.motion.code.openInTimeline")}
          title={t("designEditor.motion.code.openInTimeline")}
          onClick={input.onOpenInTimeline}
        >
          <IconTimeline className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    );
  }
  if (layer.animatedBelow.length === 0) {
    return (
      <span className="block truncate text-[11px] font-medium">
        {layer.label}
      </span>
    );
  }
  return (
    <ul className="space-y-0.5">
      {layer.animatedBelow.map((below) => (
        <li key={below.nodeId}>
          <button
            type="button"
            className="block w-full cursor-pointer truncate rounded px-1 text-left text-[11px] font-medium hover:bg-[var(--design-editor-control-bg)]"
            onMouseEnter={() => input.onHoverLayer?.(below.layerId)}
            onFocus={() => input.onHoverLayer?.(below.layerId)}
          >
            {below.label}
          </button>
        </li>
      ))}
    </ul>
  );
}

function CodeSection({
  title,
  text,
  allText,
  t,
}: {
  title?: string;
  text: string;
  /** Every section's text; copied instead while the modifier key is held. */
  allText?: string;
  t: (key: string) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split("\n");
  const long = lines.length > COLLAPSED_LINE_COUNT;
  const shown =
    long && !expanded ? lines.slice(0, COLLAPSED_LINE_COUNT).join("\n") : text;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
          {title}
        </span>
        <CopyButton text={text} allText={allText} t={t} />
      </div>
      {/* Read only: a pre element takes no typing, and dragging selects. */}
      <pre className="select-text overflow-x-auto rounded bg-[var(--design-editor-control-bg)] p-2 font-mono text-[10px] leading-relaxed text-foreground">
        <code>{shown}</code>
      </pre>
      {long && !expanded ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[10px]"
          onClick={() => setExpanded(true)}
        >
          {t("designEditor.motion.code.showMore")}
        </Button>
      ) : null}
    </div>
  );
}

function CopyButton({
  text,
  allText,
  t,
}: {
  text: string;
  allText?: string;
  t: (key: string) => string;
}) {
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [modifierHeld, setModifierHeld] = useState(false);
  const resetTimer = useRef<number | undefined>(undefined);
  const copiesAll = modifierHeld && allText !== undefined;

  useEffect(() => {
    if (!hovered) {
      setModifierHeld(false);
      return;
    }
    const sync = (event: KeyboardEvent) => setModifierHeld(event.altKey);
    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
    };
  }, [hovered]);
  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  const copy = (event: ReactMouseEvent) => {
    const value = event.altKey && allText !== undefined ? allText : text;
    navigator.clipboard.writeText(value).then(
      () => {
        setCopied(true);
        window.clearTimeout(resetTimer.current);
        resetTimer.current = window.setTimeout(() => setCopied(false), 1200);
      },
      () => toast.error(t("designEditor.motion.code.copyFailed")),
    );
  };

  const label = copiesAll
    ? t("designEditor.motion.code.copyAll")
    : copied
      ? t("designEditor.motion.code.copied")
      : t("designEditor.motion.code.copy");
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="size-6 shrink-0 px-0"
      aria-label={label}
      title={label}
      onClick={copy}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {copied ? (
        <IconCheck className="size-3.5" aria-hidden="true" />
      ) : (
        <IconCopy className="size-3.5" aria-hidden="true" />
      )}
    </Button>
  );
}
