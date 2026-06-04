import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  IconCheck,
  IconCode,
  IconDeviceDesktop,
  IconDeviceMobile,
  IconEdit,
  IconMinus,
  IconPlus,
  IconRotateClockwise,
  IconX,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type {
  PlanBlock,
  PlanCanvasFrame,
  PlanContent,
  PlanSketchDiagramBlock,
  PlanSketchWireframeBlock,
  PlanWireframeRegion,
  PlanVisualQuestion,
} from "@shared/plan-content";

type PlanContentRendererProps = {
  content: PlanContent;
  fallbackTitle: string;
  fallbackBrief: string;
  onContentChange?: (content: PlanContent) => Promise<void> | void;
  onVisualQuestionsSubmit?: (summary: string) => void;
};

const DEFAULT_CANVAS_VIEW = {
  zoom: 0.72,
  pan: { x: 80, y: 54 },
};
const MIN_CANVAS_ZOOM = 0.32;
const MAX_CANVAS_ZOOM = 2.4;
const CANVAS_WHEEL_ZOOM_SENSITIVITY = 0.0028;

type CanvasView = typeof DEFAULT_CANVAS_VIEW;

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
      <svg className="pointer-events-none absolute h-0 w-0" aria-hidden="true">
        <filter id="plan-rough">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.028"
            numOctaves="2"
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale="0.85"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </svg>
      {content.canvas && (
        <PlanCanvas
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

function PlanCanvas({
  canvas,
  blockLookup,
}: {
  canvas: NonNullable<PlanContent["canvas"]>;
  blockLookup: Map<string, PlanBlock>;
}) {
  const canvasRef = useRef<HTMLElement | null>(null);
  const [view, setView] = useState<CanvasView>(DEFAULT_CANVAS_VIEW);
  const [drag, setDrag] = useState<{
    pointerId: number;
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);
  const frames = useMemo(
    () => layoutCanvasFrames(canvas.frames),
    [canvas.frames],
  );
  const board = useMemo(() => {
    const maxX = Math.max(
      1600,
      ...frames.map((frame) => (frame.x ?? 0) + (frame.width ?? 420)),
    );
    const maxY = Math.max(
      980,
      ...frames.map((frame) => (frame.y ?? 0) + (frame.height ?? 360)),
    );
    return { width: maxX + 360, height: maxY + 260 };
  }, [frames]);
  const { zoom, pan } = view;

  const zoomBy = useCallback(
    (factor: number, anchor?: { x: number; y: number }) => {
      setView((current) => {
        const nextZoom = clamp(
          current.zoom * factor,
          MIN_CANVAS_ZOOM,
          MAX_CANVAS_ZOOM,
        );
        if (Math.abs(nextZoom - current.zoom) < 0.0001) return current;

        const rect = canvasRef.current?.getBoundingClientRect();
        const anchorPoint =
          anchor ??
          (rect ? { x: rect.width / 2, y: rect.height / 2 } : { x: 0, y: 0 });
        const worldX = (anchorPoint.x - current.pan.x) / current.zoom;
        const worldY = (anchorPoint.y - current.pan.y) / current.zoom;

        return {
          zoom: nextZoom,
          pan: {
            x: anchorPoint.x - worldX * nextZoom,
            y: anchorPoint.y - worldY * nextZoom,
          },
        };
      });
    },
    [],
  );

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const deltaScale =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? element.clientHeight
            : 1;
      const deltaX = event.deltaX * deltaScale;
      const deltaY = event.deltaY * deltaScale;

      if (event.ctrlKey || event.metaKey) {
        const rect = element.getBoundingClientRect();
        zoomBy(Math.exp(-deltaY * CANVAS_WHEEL_ZOOM_SENSITIVITY), {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
        return;
      }

      setView((current) => ({
        ...current,
        pan: {
          x: current.pan.x - (deltaX || (event.shiftKey ? deltaY : 0)),
          y: current.pan.y - (event.shiftKey ? 0 : deltaY),
        },
      }));
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-plan-interactive]")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: pan.x,
      panY: pan.y,
    });
  };

  return (
    <section
      ref={canvasRef}
      className="plan-canvas relative h-[70vh] min-h-[520px] cursor-grab overflow-hidden border-b border-plan-line active:cursor-grabbing"
      style={{
        backgroundPosition: `${pan.x}px ${pan.y}px`,
        backgroundSize: `${28 * zoom}px ${28 * zoom}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={(event) => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        event.preventDefault();
        setView((current) => ({
          ...current,
          pan: {
            x: drag.panX + event.clientX - drag.startX,
            y: drag.panY + event.clientY - drag.startY,
          },
        }));
      }}
      onPointerUp={(event) => {
        if (drag?.pointerId === event.pointerId) {
          event.currentTarget.releasePointerCapture(event.pointerId);
          setDrag(null);
        }
      }}
      onPointerCancel={() => setDrag(null)}
    >
      <div
        className="relative origin-top-left"
        style={{
          width: board.width,
          height: board.height,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        }}
      >
        {canvas.flow?.map((edge, index) => (
          <CanvasConnector
            key={`${edge.from}-${edge.to}-${index}`}
            edge={edge}
            frames={frames}
          />
        ))}
        {frames.map((frame) => (
          <CanvasFrame
            key={frame.id}
            frame={frame}
            block={frame.blockId ? blockLookup.get(frame.blockId) : undefined}
          />
        ))}
        {canvas.notes?.map((note) => (
          <div
            key={note.id}
            className="absolute max-w-[300px] text-sm leading-6 text-plan-muted"
            style={{ left: note.x ?? 60, top: note.y ?? 60 }}
          >
            {note.title && (
              <p className="mb-1 font-semibold text-plan-text">{note.title}</p>
            )}
            <p>{note.body}</p>
          </div>
        ))}
      </div>
      <div
        className="absolute bottom-4 left-4 z-10 flex items-center gap-1 rounded-lg border border-plan-line bg-plan-chrome p-1 shadow-lg backdrop-blur"
        data-plan-interactive
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => zoomBy(1 / 1.18)}
          aria-label="Zoom out"
        >
          <IconMinus className="size-3.5" />
        </Button>
        <span className="min-w-12 text-center text-sm font-semibold">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => zoomBy(1.18)}
          aria-label="Zoom in"
        >
          <IconPlus className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => {
            setView(DEFAULT_CANVAS_VIEW);
          }}
          aria-label="Reset canvas"
        >
          <IconRotateClockwise className="size-3.5" />
        </Button>
      </div>
    </section>
  );
}

function layoutCanvasFrames(frames: PlanCanvasFrame[]): PlanCanvasFrame[] {
  return frames.map((frame, index) => {
    const explicitSize =
      frame.width !== undefined || frame.height !== undefined;
    const isPhone = frame.wireframe?.viewport === "phone";
    const width = frame.width ?? (isPhone ? 300 : index === 0 ? 640 : 560);
    const height = frame.height ?? (isPhone ? 520 : 420);
    if (frame.x !== undefined || frame.y !== undefined || explicitSize) {
      return {
        ...frame,
        width,
        height,
        x: frame.x ?? 80,
        y: frame.y ?? 80,
      };
    }
    const desktopCountBefore = frames
      .slice(0, index)
      .filter((candidate) => candidate.wireframe?.viewport !== "phone").length;
    const phoneCountBefore = frames
      .slice(0, index)
      .filter((candidate) => candidate.wireframe?.viewport === "phone").length;
    return {
      ...frame,
      width,
      height,
      x: isPhone ? 780 + phoneCountBefore * 380 : 80 + desktopCountBefore * 700,
      y: isPhone ? 80 : 80 + Math.floor(desktopCountBefore / 2) * 520,
    };
  });
}

function CanvasFrame({
  frame,
  block,
}: {
  frame: PlanCanvasFrame;
  block?: PlanBlock;
}) {
  const wireframe =
    frame.wireframe ||
    (block?.type === "sketch-wireframe" ? block.data : undefined);
  return (
    <div
      className="absolute"
      data-canvas-frame={frame.id}
      style={{
        left: frame.x ?? 80,
        top: frame.y ?? 80,
        width: frame.width ?? 420,
      }}
    >
      <p className="mb-2 text-sm font-semibold text-plan-canvas-text">
        {frame.title}
      </p>
      {wireframe ? (
        <SketchWireframe data={wireframe} canvasSize={frame.height} />
      ) : (
        <div
          className="rounded-[18px] border-2 border-plan-sketch-line"
          style={{ height: frame.height ?? 360 }}
        />
      )}
    </div>
  );
}

function CanvasConnector({
  edge,
  frames,
}: {
  edge: { from: string; to: string; label?: string };
  frames: PlanCanvasFrame[];
}) {
  const from = frames.find((frame) => frame.id === edge.from);
  const to = frames.find((frame) => frame.id === edge.to);
  if (!from || !to) return null;
  const fromX = (from.x ?? 0) + (from.width ?? 420) + 24;
  const fromY = (from.y ?? 0) + (from.height ?? 360) / 2;
  const toX = (to.x ?? 0) - 24;
  const toY = (to.y ?? 0) + (to.height ?? 360) / 2;
  const left = Math.min(fromX, toX);
  const top = Math.min(fromY, toY);
  const width = Math.abs(toX - fromX);
  const height = Math.abs(toY - fromY) || 1;
  return (
    <svg
      className="pointer-events-none absolute overflow-visible"
      style={{ left, top, width, height }}
      viewBox={`0 0 ${width} ${height}`}
    >
      <path
        d={`M ${fromX - left} ${fromY - top} C ${width / 2} ${fromY - top}, ${width / 2} ${toY - top}, ${toX - left} ${toY - top}`}
        fill="none"
        stroke="hsl(var(--ring))"
        strokeDasharray="10 8"
        strokeLinecap="round"
        strokeWidth="3"
      />
      {edge.label && (
        <text
          x={width / 2}
          y={height / 2 - 8}
          textAnchor="middle"
          className="fill-[hsl(var(--ring))] text-[16px] font-semibold"
        >
          {edge.label}
        </text>
      )}
    </svg>
  );
}

function PlanBlockView({
  block,
  onChange,
  onVisualQuestionsSubmit,
}: {
  block: PlanBlock;
  onChange?: (block: PlanBlock) => void;
  onVisualQuestionsSubmit?: (summary: string) => void;
}) {
  if (block.type === "rich-text") {
    return <RichTextBlock block={block} onChange={onChange} />;
  }
  if (block.type === "callout") {
    return (
      <section className="plan-block plan-callout" data-block-id={block.id}>
        {block.title && <h2>{block.title}</h2>}
        <p>{block.data.body}</p>
      </section>
    );
  }
  if (block.type === "checklist") {
    return (
      <section className="plan-block" data-block-id={block.id}>
        {block.title && <h2>{block.title}</h2>}
        <div className="grid gap-3">
          {block.data.items.map((item) => (
            <button
              key={item.id}
              type="button"
              data-plan-interactive
              className="flex items-start gap-3 text-left text-plan-muted"
              onClick={() =>
                onChange?.({
                  ...block,
                  data: {
                    items: block.data.items.map((current) =>
                      current.id === item.id
                        ? { ...current, checked: !current.checked }
                        : current,
                    ),
                  },
                })
              }
            >
              <span
                className={cn(
                  "mt-1 flex size-5 items-center justify-center rounded border",
                  item.checked
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-plan-line",
                )}
              >
                {item.checked && <IconCheck className="size-3.5" />}
              </span>
              <span>
                <span className="block text-plan-text">{item.label}</span>
                {item.note && (
                  <span className="block text-sm">{item.note}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      </section>
    );
  }
  if (block.type === "table") {
    return (
      <section className="plan-block overflow-x-auto" data-block-id={block.id}>
        {block.title && <h2>{block.title}</h2>}
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead>
            <tr className="border-b border-plan-line text-sm text-plan-muted">
              {block.data.columns.map((column) => (
                <th key={column} className="py-3 pr-4 font-semibold">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.data.rows.map((row, index) => (
              <tr key={index} className="border-b border-plan-line">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="py-4 pr-4 text-plan-muted">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  }
  if (block.type === "code-tabs") {
    return <CodeTabsBlock block={block} />;
  }
  if (block.type === "implementation-map") {
    return <ImplementationMapBlock block={block} />;
  }
  if (block.type === "sketch-wireframe") {
    return (
      <section className="plan-block" data-block-id={block.id}>
        {block.title && <h2>{block.title}</h2>}
        <SketchWireframe data={block.data} />
        {block.summary && (
          <p className="mt-5 text-plan-muted">{block.summary}</p>
        )}
      </section>
    );
  }
  if (block.type === "sketch-diagram") {
    return (
      <section className="plan-block" data-block-id={block.id}>
        {block.title && <h2>{block.title}</h2>}
        <SketchDiagram data={block.data} />
      </section>
    );
  }
  if (block.type === "decision") {
    return (
      <section className="plan-block" data-block-id={block.id}>
        {block.title && <h2>{block.title}</h2>}
        <p className="mt-3 max-w-3xl text-lg leading-8 text-plan-muted">
          {block.data.question}
        </p>
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {block.data.options.map((option) => (
            <article
              key={option.id}
              className={cn(
                "rounded-xl border border-plan-line bg-plan-block p-4",
                option.selected
                  ? "shadow-[inset_3px_0_0_hsl(var(--ring))]"
                  : "opacity-85",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-lg font-semibold tracking-tight text-plan-text">
                  {option.label}
                </h3>
                {(option.selected || option.recommended) && (
                  <span className="rounded-full border border-plan-line px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-plan-muted">
                    {option.selected ? "Selected" : "Recommended"}
                  </span>
                )}
              </div>
              {option.detail && (
                <p className="mt-3 text-sm leading-6 text-plan-muted">
                  {option.detail}
                </p>
              )}
            </article>
          ))}
        </div>
      </section>
    );
  }
  if (block.type === "tabs") {
    return (
      <TabsBlock
        block={block}
        onChange={onChange}
        onVisualQuestionsSubmit={onVisualQuestionsSubmit}
      />
    );
  }
  if (block.type === "custom-html") {
    return <CustomHtmlBlock block={block} onChange={onChange} />;
  }
  if (block.type === "visual-questions") {
    return (
      <VisualQuestionsBlock
        block={block}
        onChange={onChange}
        onSubmit={onVisualQuestionsSubmit}
      />
    );
  }
  return null;
}

function RichTextBlock({
  block,
  onChange,
}: {
  block: Extract<PlanBlock, { type: "rich-text" }>;
  onChange?: (block: PlanBlock) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(block.data.markdown);
  return (
    <section className="plan-block group" data-block-id={block.id}>
      <div className="flex items-start justify-between gap-4">
        {block.title && <h2>{block.title}</h2>}
        {block.editable && onChange && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="opacity-70 transition-opacity group-hover:opacity-100"
            data-plan-interactive
            onClick={() => {
              setDraft(block.data.markdown);
              setEditing((value) => !value);
            }}
          >
            {editing ? (
              <IconX className="size-4" />
            ) : (
              <IconEdit className="size-4" />
            )}
            {editing ? "Cancel" : "Edit"}
          </Button>
        )}
      </div>
      {editing ? (
        <div className="mt-4 space-y-3" data-plan-interactive>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDraft((value) => `## ${value}`)}
            >
              Heading
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDraft((value) => appendLine(value, "- "))}
            >
              Bullet
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDraft((value) => appendLine(value, "> "))}
            >
              Quote
            </Button>
          </div>
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="min-h-48 resize-y rounded-xl border-plan-line bg-plan-block font-mono text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                onChange?.({
                  ...block,
                  data: { ...block.data, markdown: draft },
                });
                setEditing(false);
              }}
            >
              Save
            </Button>
          </div>
        </div>
      ) : (
        <div className="plan-copy mt-4">
          {renderMarkdown(block.data.markdown)}
        </div>
      )}
    </section>
  );
}

function CodeTabsBlock({
  block,
}: {
  block: Extract<PlanBlock, { type: "code-tabs" }>;
}) {
  const [activeId, setActiveId] = useState(block.data.tabs[0]?.id ?? "");
  const active =
    block.data.tabs.find((tab) => tab.id === activeId) ?? block.data.tabs[0];
  return (
    <section className="plan-block" data-block-id={block.id}>
      {block.title && <h2>{block.title}</h2>}
      <div className="grid overflow-hidden border-y border-plan-line md:grid-cols-[300px_minmax(0,1fr)]">
        <div className="border-plan-line md:border-r">
          {block.data.tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              data-plan-interactive
              className={cn(
                "flex w-full items-start gap-3 border-b border-plan-line px-4 py-4 text-left",
                tab.id === active?.id
                  ? "bg-plan-block text-plan-text shadow-[inset_3px_0_0_hsl(var(--ring))]"
                  : "text-plan-muted hover:bg-accent/30",
              )}
              onClick={() => setActiveId(tab.id)}
            >
              <IconCode className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0">
                <span className="block truncate font-mono text-sm font-semibold">
                  {tab.label}
                </span>
                {tab.caption && (
                  <span className="mt-1 block text-xs leading-5">
                    {tab.caption}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
        <div className="min-w-0 p-5">
          {active && (
            <>
              <h3 className="text-2xl font-semibold tracking-tight">
                {active.label}
              </h3>
              {active.caption && (
                <p className="mt-2 text-plan-muted">{active.caption}</p>
              )}
              <CodeBlock code={active.code} language={active.language} />
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function CodeBlock({
  code,
  language,
  className,
}: {
  code: string;
  language?: string;
  className?: string;
}) {
  return (
    <pre
      className={cn(
        "max-h-[520px] overflow-auto rounded-xl border border-plan-line bg-plan-code p-5 text-sm leading-7 text-plan-code-text",
        className ?? "mt-5",
      )}
    >
      <code>{highlightCode(code, language)}</code>
    </pre>
  );
}

function ImplementationMapBlock({
  block,
}: {
  block: Extract<PlanBlock, { type: "implementation-map" }>;
}) {
  const [activePath, setActivePath] = useState(block.data.files[0]?.path ?? "");
  const active =
    block.data.files.find((file) => file.path === activePath) ??
    block.data.files[0];
  return (
    <section className="plan-block" data-block-id={block.id}>
      {block.title && <h2>{block.title}</h2>}
      <div className="grid overflow-hidden border-y border-plan-line lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="border-plan-line lg:border-r">
          {block.data.files.map((file) => (
            <button
              key={file.path}
              type="button"
              data-plan-interactive
              onClick={() => setActivePath(file.path)}
              className={cn(
                "grid w-full gap-1 border-b border-plan-line px-4 py-5 text-left",
                file.path === active?.path
                  ? "bg-plan-block text-plan-text shadow-[inset_3px_0_0_hsl(var(--ring))]"
                  : "text-plan-muted hover:bg-accent/30",
              )}
            >
              <span className="truncate font-mono text-sm font-semibold">
                {file.title || file.path.split("/").pop()}
              </span>
              <span className="truncate font-mono text-xs">{file.path}</span>
            </button>
          ))}
        </div>
        <div className="min-w-0 p-6">
          {active && (
            <>
              <p className="font-mono text-sm text-plan-muted">{active.path}</p>
              <h3 className="mt-3 text-3xl font-semibold tracking-tight">
                {active.title || active.path.split("/").pop()}
              </h3>
              <p className="mt-4 max-w-3xl text-xl leading-8 text-plan-muted">
                {active.note}
              </p>
              {active.snippet && (
                <CodeBlock
                  code={active.snippet}
                  language={active.language}
                  className="mt-6"
                />
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function TabsBlock({
  block,
  onChange,
  onVisualQuestionsSubmit,
}: {
  block: Extract<PlanBlock, { type: "tabs" }>;
  onChange?: (block: PlanBlock) => void;
  onVisualQuestionsSubmit?: (summary: string) => void;
}) {
  const [activeId, setActiveId] = useState(block.data.tabs[0]?.id ?? "");
  const active =
    block.data.tabs.find((tab) => tab.id === activeId) ?? block.data.tabs[0];
  return (
    <section className="plan-block" data-block-id={block.id}>
      {block.title && <h2>{block.title}</h2>}
      <div
        className="mb-8 inline-flex max-w-full gap-1 overflow-x-auto rounded-xl bg-plan-block p-1"
        data-plan-interactive
      >
        {block.data.tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveId(tab.id)}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
              tab.id === active?.id
                ? "bg-plan-document text-plan-text shadow-sm"
                : "text-plan-muted hover:bg-accent/30 hover:text-plan-text",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {active && (
        <div>
          {active.blocks.map((child) => (
            <PlanBlockView
              key={child.id}
              block={child}
              onVisualQuestionsSubmit={onVisualQuestionsSubmit}
              onChange={(nextChild) => {
                onChange?.({
                  ...block,
                  data: {
                    tabs: block.data.tabs.map((tab) =>
                      tab.id === active.id
                        ? {
                            ...tab,
                            blocks: updateBlocks(
                              tab.blocks,
                              child.id,
                              () => nextChild,
                            ),
                          }
                        : tab,
                    ),
                  },
                });
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CustomHtmlBlock({
  block,
  onChange,
}: {
  block: Extract<PlanBlock, { type: "custom-html" }>;
  onChange?: (block: PlanBlock) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [html, setHtml] = useState(block.data.html);
  const [css, setCss] = useState(block.data.css ?? "");
  const srcDoc = `<!doctype html><html><head><style>body{margin:0;min-height:100%;font-family:Inter,system-ui,sans-serif;color:#1f1f1d;background:transparent;}*{box-sizing:border-box}${block.data.css ?? ""}</style></head><body>${block.data.html}</body></html>`;
  return (
    <section className="plan-block group" data-block-id={block.id}>
      <div className="flex items-start justify-between gap-4">
        {block.title && <h2>{block.title}</h2>}
        {onChange && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-plan-interactive
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? (
              <IconX className="size-4" />
            ) : (
              <IconEdit className="size-4" />
            )}
            {editing ? "Cancel" : "Edit source"}
          </Button>
        )}
      </div>
      {editing ? (
        <div className="mt-4 grid gap-3" data-plan-interactive>
          <Textarea
            value={html}
            onChange={(event) => setHtml(event.target.value)}
            className="min-h-48 font-mono text-sm"
            placeholder="HTML fragment"
          />
          <Textarea
            value={css}
            onChange={(event) => setCss(event.target.value)}
            className="min-h-32 font-mono text-sm"
            placeholder="Optional CSS"
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                onChange?.({
                  ...block,
                  data: { ...block.data, html, css: css || undefined },
                });
                setEditing(false);
              }}
            >
              Save
            </Button>
          </div>
        </div>
      ) : (
        <>
          <iframe
            title={block.title || "Custom HTML block"}
            srcDoc={srcDoc}
            sandbox="allow-same-origin"
            referrerPolicy="no-referrer"
            className="mt-4 h-[360px] w-full rounded-xl border border-plan-line bg-plan-block"
          />
          {block.data.caption && (
            <p className="mt-3 text-sm text-plan-muted">{block.data.caption}</p>
          )}
        </>
      )}
    </section>
  );
}

function VisualQuestionsBlock({
  block,
  onChange,
  onSubmit,
}: {
  block: Extract<PlanBlock, { type: "visual-questions" }>;
  onChange?: (block: PlanBlock) => void;
  onSubmit?: (summary: string) => void;
}) {
  const [questions, setQuestions] = useState(block.data.questions);

  useEffect(() => {
    setQuestions(block.data.questions);
  }, [block.id, block.data.questions]);

  const updateQuestion = (
    questionId: string,
    nextQuestion: PlanVisualQuestion,
  ) => {
    setQuestions((currentQuestions) => {
      const nextQuestions = currentQuestions.map((question) =>
        question.id === questionId ? nextQuestion : question,
      );
      onChange?.({
        ...block,
        data: {
          ...block.data,
          questions: nextQuestions,
        },
      });
      return nextQuestions;
    });
  };
  const answered = questions.filter((question) => {
    if (question.mode === "freeform") return Boolean(question.value?.trim());
    return question.options?.some((option) => option.selected);
  }).length;
  return (
    <section className="plan-questions-block" data-block-id={block.id}>
      {block.title && <h2>{block.title}</h2>}
      <div className="mt-8 grid gap-14">
        {questions.map((question, index) => (
          <VisualQuestionView
            key={question.id}
            question={question}
            index={index}
            onChange={(nextQuestion) =>
              updateQuestion(question.id, nextQuestion)
            }
          />
        ))}
      </div>
      <div className="sticky bottom-0 mt-14 flex items-center justify-between gap-4 border-t border-plan-line bg-plan-document py-4 backdrop-blur">
        <p className="text-sm font-semibold text-plan-muted">
          {answered}/{questions.length} answered
        </p>
        <div className="flex gap-2" data-plan-interactive>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(
                summarizeVisualQuestions(questions),
              );
            }}
          >
            Copy prompt
          </Button>
          <Button
            type="button"
            onClick={() => onSubmit?.(summarizeVisualQuestions(questions))}
          >
            {block.data.submitLabel || "Send to agent"}
          </Button>
        </div>
      </div>
    </section>
  );
}

function summarizeVisualQuestions(questions: PlanVisualQuestion[]) {
  const lines = [
    "Use these visual intake answers to create or update the visual plan:",
    "",
  ];
  for (const question of questions) {
    const answer =
      question.mode === "freeform"
        ? question.value?.trim()
        : question.options
            ?.filter((option) => option.selected)
            .map((option) => option.label)
            .join(", ");
    lines.push(`- ${question.title}: ${answer || "No answer yet"}`);
  }
  return lines.join("\n");
}

function VisualQuestionView({
  question,
  index,
  onChange,
}: {
  question: PlanVisualQuestion;
  index: number;
  onChange: (question: PlanVisualQuestion) => void;
}) {
  return (
    <article className="grid gap-6 sm:grid-cols-[46px_minmax(0,1fr)]">
      <div className="flex size-8 items-center justify-center rounded-full border border-plan-line bg-plan-block text-sm font-semibold text-plan-muted">
        {index + 1}
      </div>
      <div>
        <h3 className="text-3xl font-semibold leading-tight tracking-[-0.02em] sm:text-4xl">
          {question.title}
        </h3>
        {question.subtitle && (
          <p className="mt-3 max-w-3xl text-lg leading-8 text-plan-muted">
            {question.subtitle}
          </p>
        )}
        {question.mode === "freeform" ? (
          <Textarea
            value={question.value ?? ""}
            onChange={(event) =>
              onChange({ ...question, value: event.target.value })
            }
            className="mt-6 min-h-28 rounded-xl border-plan-line bg-plan-block text-base"
            data-plan-interactive
            placeholder="Add details..."
          />
        ) : (
          <div className="mt-6 grid gap-7">
            {question.options?.map((option, optionIndex) => (
              <button
                key={option.id}
                type="button"
                data-plan-interactive
                className="grid gap-5 border-b border-plan-line pb-7 text-left last:border-b-0"
                onClick={() => {
                  onChange({
                    ...question,
                    options: question.options?.map((current) =>
                      question.mode === "single"
                        ? { ...current, selected: current.id === option.id }
                        : current.id === option.id
                          ? { ...current, selected: !current.selected }
                          : current,
                    ),
                  });
                }}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "mt-1 flex size-5 shrink-0 items-center justify-center border",
                      question.mode === "single" ? "rounded-full" : "rounded",
                      option.selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-plan-line",
                    )}
                  >
                    {option.selected && <IconCheck className="size-3.5" />}
                  </span>
                  <span>
                    <span className="text-xl font-semibold text-plan-text">
                      {option.label}
                    </span>
                    {option.recommended && (
                      <span className="ml-3 rounded-full border border-primary/30 px-2 py-0.5 text-xs font-bold uppercase tracking-[0.12em] text-primary">
                        Recommended
                      </span>
                    )}
                    {option.detail && (
                      <span className="mt-2 block max-w-2xl whitespace-pre-line text-base leading-7 text-plan-muted">
                        {option.detail}
                      </span>
                    )}
                  </span>
                </div>
                {(option.wireframe || option.diagram) && (
                  <div className="ml-8 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                    {option.wireframe && (
                      <SketchWireframe data={option.wireframe} compact />
                    )}
                    {option.diagram && (
                      <SketchDiagram data={option.diagram} compact />
                    )}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function SketchWireframe({
  data,
  compact,
  canvasSize,
}: {
  data: PlanSketchWireframeBlock["data"];
  compact?: boolean;
  canvasSize?: number;
}) {
  const isPhone = data.viewport === "phone";
  return (
    <div
      className={cn(
        "plan-sketch relative overflow-hidden bg-plan-wireframe text-plan-sketch-line",
        isPhone ? "mx-auto w-[260px] rounded-[34px]" : "w-full rounded-[16px]",
        compact && "max-w-[620px]",
      )}
      style={{
        height: canvasSize ?? (isPhone ? 460 : compact ? 260 : 360),
      }}
    >
      {isPhone && (
        <div className="absolute left-1/2 top-3 h-1.5 w-10 -translate-x-1/2 rounded-full bg-plan-muted-line" />
      )}
      <RoughBox id={`wireframe-${data.viewport ?? "desktop"}`} />
      {data.regions.map((region) => (
        <RoughRegion key={region.id} region={region} />
      ))}
    </div>
  );
}

function RoughRegion({ region }: { region: PlanWireframeRegion }) {
  return (
    <div
      className={cn(
        "plan-sketch-region absolute",
        region.kind === "list" && "plan-region-list",
        region.kind === "button" && "plan-region-button",
        region.kind === "input" && "plan-region-input",
        region.emphasis && "text-primary",
      )}
      style={{
        left: `${region.x}%`,
        top: `${region.y}%`,
        width: `${region.width}%`,
        height: `${region.height}%`,
      }}
    >
      <RoughBox id={region.id} emphasis={region.emphasis} />
      {region.label && (
        <span className="plan-sketch-label absolute left-2 top-1 max-w-[calc(100%-1rem)] truncate text-[12px] font-semibold">
          {region.label}
        </span>
      )}
    </div>
  );
}

function RoughBox({ id, emphasis }: { id: string; emphasis?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className="plan-rough-svg pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      <path
        d={roughRectPath(id, 0)}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={emphasis ? 2.2 : 1.55}
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={roughRectPath(id, 1)}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={emphasis ? 1.8 : 1.15}
        vectorEffect="non-scaling-stroke"
        opacity="0.72"
      />
    </svg>
  );
}

function roughRectPath(seed: string, pass: number) {
  const point = (index: number, x: number, y: number) => {
    const jitterX = roughNoise(`${seed}:${pass}:${index}:x`) * 2.2 - 1.1;
    const jitterY = roughNoise(`${seed}:${pass}:${index}:y`) * 2.2 - 1.1;
    return `${roundPoint(x + jitterX)} ${roundPoint(y + jitterY)}`;
  };
  return [
    `M ${point(0, 3.5, 4)}`,
    `L ${point(1, 25, 3)}`,
    `L ${point(2, 51, 4)}`,
    `L ${point(3, 75, 3)}`,
    `L ${point(4, 96.5, 4.5)}`,
    `L ${point(5, 96, 30)}`,
    `L ${point(6, 97, 63)}`,
    `L ${point(7, 95.5, 96)}`,
    `L ${point(8, 73, 97)}`,
    `L ${point(9, 48, 96)}`,
    `L ${point(10, 24, 97)}`,
    `L ${point(11, 4.5, 95.5)}`,
    `L ${point(12, 3, 67)}`,
    `L ${point(13, 4, 34)}`,
    "Z",
  ].join(" ");
}

function roughNoise(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function roundPoint(value: number) {
  return Math.round(value * 10) / 10;
}

function SketchDiagram({
  data,
  compact,
}: {
  data: PlanSketchDiagramBlock["data"];
  compact?: boolean;
}) {
  const nodes = orderDiagramNodes(data.nodes, data.edges);
  return (
    <div className="plan-sketch rounded-[16px] border border-plan-line bg-plan-wireframe p-5">
      <div
        className={cn(
          "flex gap-3 overflow-x-auto pb-2",
          compact ? "items-center" : "items-stretch",
        )}
      >
        {nodes.map((node, index) => {
          const next = nodes[index + 1];
          const edge = next
            ? data.edges.find(
                (candidate) =>
                  candidate.from === node.id && candidate.to === next.id,
              )
            : undefined;
          return (
            <div key={node.id} className="flex min-w-max items-center gap-3">
              <article
                className={cn(
                  "w-[180px] rounded-xl border-2 border-plan-sketch-line bg-plan-document p-3 text-plan-text",
                  compact && "w-[150px]",
                )}
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-plan-muted">
                  {index + 1}
                </p>
                <h3 className="mt-2 text-base font-semibold leading-tight">
                  {node.label}
                </h3>
                {node.detail && !compact && (
                  <p className="mt-2 text-xs leading-5 text-plan-muted">
                    {node.detail}
                  </p>
                )}
              </article>
              {next && (
                <div className="grid min-w-[72px] justify-items-center gap-1 text-primary">
                  {edge?.label && (
                    <span className="max-w-[96px] truncate rounded-full border border-primary/35 px-2 py-0.5 text-[11px] font-semibold">
                      {edge.label}
                    </span>
                  )}
                  <span className="h-0.5 w-full rounded-full border-t-2 border-dashed border-primary" />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {data.notes && data.notes.length > 0 && !compact && (
        <div className="mt-4 grid gap-2 border-t border-plan-line pt-4 text-sm text-plan-muted md:grid-cols-2">
          {data.notes.map((note) => (
            <p key={note.id}>{note.text}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function orderDiagramNodes(
  nodes: PlanSketchDiagramBlock["data"]["nodes"],
  edges: PlanSketchDiagramBlock["data"]["edges"],
) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const targets = new Set(edges.map((edge) => edge.to));
  const first = nodes.find((node) => !targets.has(node.id)) ?? nodes[0];
  if (!first) return nodes;

  const ordered = [first];
  const seen = new Set([first.id]);
  let current = first;
  while (current) {
    const nextEdge = edges.find(
      (edge) => edge.from === current.id && !seen.has(edge.to),
    );
    const next = nextEdge ? nodeById.get(nextEdge.to) : undefined;
    if (!next) break;
    ordered.push(next);
    seen.add(next.id);
    current = next;
  }

  for (const node of nodes) {
    if (!seen.has(node.id)) ordered.push(node);
  }
  return ordered;
}

function highlightCode(code: string, language?: string): ReactNode[] {
  const languageKey = (language || "").toLowerCase();
  const tokens =
    languageKey.includes("tsx") ||
    languageKey.includes("ts") ||
    languageKey.includes("jsx") ||
    languageKey.includes("js")
      ? tokenizeCode(code)
      : tokenizeCode(code);
  return tokens.map((token, index) =>
    token.className ? (
      <span key={index} className={token.className}>
        {token.text}
      </span>
    ) : (
      token.text
    ),
  );
}

function tokenizeCode(code: string) {
  const tokens: Array<{ text: string; className?: string }> = [];
  const pattern =
    /(\/\/.*|\/\*[\s\S]*?\*\/|`(?:\\.|[^`])*`|"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|<\/?[A-Za-z][^>\s/]*(?:\s+[^>]*)?>|\b(?:async|await|break|case|catch|class|const|continue|default|else|export|extends|false|finally|for|from|function|if|import|interface|let|new|null|return|switch|true|type|undefined|var|while)\b|\b\d+(?:\.\d+)?\b)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code))) {
    if (match.index > lastIndex) {
      tokens.push({ text: code.slice(lastIndex, match.index) });
    }
    const text = match[0];
    tokens.push({ text, className: codeTokenClass(text) });
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < code.length) {
    tokens.push({ text: code.slice(lastIndex) });
  }
  return tokens;
}

function codeTokenClass(token: string) {
  if (token.startsWith("//") || token.startsWith("/*")) {
    return "text-zinc-500 dark:text-zinc-500";
  }
  if (token.startsWith('"') || token.startsWith("'") || token.startsWith("`")) {
    return "text-emerald-700 dark:text-emerald-300";
  }
  if (token.startsWith("<")) {
    return "text-sky-700 dark:text-sky-300";
  }
  if (/^\d/.test(token)) {
    return "text-amber-700 dark:text-amber-300";
  }
  return "text-blue-700 dark:text-blue-300";
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

function renderMarkdown(markdown: string) {
  const nodes: ReactNode[] = [];
  let list: string[] = [];
  const flushList = (key: string) => {
    if (list.length === 0) return;
    nodes.push(
      <ul key={key} className="my-4 list-disc space-y-2 pl-6">
        {list.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>,
    );
    list = [];
  };
  markdown.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) {
      flushList(`list-${index}`);
      return;
    }
    const listItem = /^[-*]\s+(.+)$/.exec(line);
    if (listItem?.[1]) {
      list.push(listItem[1]);
      return;
    }
    flushList(`list-${index}`);
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading?.[2]) {
      nodes.push(
        <h3 key={index} className="mt-8 text-2xl font-semibold text-plan-text">
          {heading[2]}
        </h3>,
      );
      return;
    }
    const quote = /^>\s+(.+)$/.exec(line);
    if (quote?.[1]) {
      nodes.push(
        <blockquote
          key={index}
          className="my-4 border-l-2 border-plan-line pl-4 text-plan-muted"
        >
          {quote[1]}
        </blockquote>,
      );
      return;
    }
    nodes.push(
      <p key={index} className="my-3">
        {line}
      </p>,
    );
  });
  flushList("list-end");
  return nodes;
}

function appendLine(value: string, prefix: string) {
  const suffix = value.endsWith("\n") || value.length === 0 ? "" : "\n";
  return `${value}${suffix}${prefix}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
