import {
  useEffect,
  useMemo,
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
  PlanVisualQuestion,
} from "@shared/plan-content";

type PlanContentRendererProps = {
  content: PlanContent;
  fallbackTitle: string;
  fallbackBrief: string;
  onContentChange?: (content: PlanContent) => Promise<void> | void;
  onVisualQuestionsSubmit?: (summary: string) => void;
};

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
  const [zoom, setZoom] = useState(0.72);
  const [pan, setPan] = useState({ x: 80, y: 54 });
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

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-plan-interactive]")) return;
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
      className="plan-canvas relative h-[70vh] min-h-[520px] overflow-hidden border-b border-plan-line"
      style={{
        backgroundPosition: `${pan.x}px ${pan.y}px`,
        backgroundSize: `${28 * zoom}px ${28 * zoom}px`,
      }}
      onWheel={(event) => {
        event.preventDefault();
        if (event.ctrlKey || event.metaKey) {
          setZoom((value) => clamp(value - event.deltaY * 0.001, 0.36, 1.8));
          return;
        }
        setPan((value) => ({
          x: value.x - event.deltaX,
          y: value.y - event.deltaY,
        }));
      }}
      onPointerDown={onPointerDown}
      onPointerMove={(event) => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        setPan({
          x: drag.panX + event.clientX - drag.startX,
          y: drag.panY + event.clientY - drag.startY,
        });
      }}
      onPointerUp={(event) => {
        if (drag?.pointerId === event.pointerId) setDrag(null);
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
          onClick={() => setZoom((value) => clamp(value - 0.08, 0.36, 1.8))}
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
          onClick={() => setZoom((value) => clamp(value + 0.08, 0.36, 1.8))}
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
            setZoom(0.72);
            setPan({ x: 80, y: 54 });
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
        <p className="text-xl text-plan-muted">{block.data.question}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          {block.data.options.map((option) => (
            <span
              key={option.id}
              className={cn(
                "rounded-full border border-plan-line px-4 py-2 text-sm font-medium",
                option.selected
                  ? "bg-primary text-primary-foreground"
                  : "text-plan-muted",
              )}
            >
              {option.label}
            </span>
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
              <pre className="mt-5 max-h-[520px] overflow-auto rounded-xl border border-plan-line bg-plan-code p-5 text-sm leading-7 text-plan-code-text">
                <code>{active.code}</code>
              </pre>
            </>
          )}
        </div>
      </div>
    </section>
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
                <pre className="mt-6 max-h-[520px] overflow-auto rounded-xl border border-plan-line bg-plan-code p-5 text-sm leading-7 text-plan-code-text">
                  <code>{active.snippet}</code>
                </pre>
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
  const srcDoc = `<!doctype html><html><head><style>body{margin:0;font-family:Inter,system-ui,sans-serif;color:CanvasText;background:Canvas;}*{box-sizing:border-box}${block.data.css ?? ""}</style></head><body>${block.data.html}</body></html>`;
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
            sandbox=""
            className="mt-4 min-h-[320px] w-full rounded-xl border border-plan-line bg-plan-block"
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
        "plan-sketch relative overflow-hidden border-2 border-plan-sketch-line bg-plan-wireframe text-plan-sketch-line",
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
      {data.regions.map((region) => (
        <div
          key={region.id}
          className={cn(
            "absolute rounded-[10px] border border-current",
            region.kind === "list" && "plan-region-list",
            region.kind === "button" && "plan-region-button",
            region.kind === "input" && "plan-region-input",
            region.emphasis && "border-primary text-primary",
          )}
          style={{
            left: `${region.x}%`,
            top: `${region.y}%`,
            width: `${region.width}%`,
            height: `${region.height}%`,
          }}
        >
          {region.label && (
            <span className="absolute left-2 top-1 text-[12px] font-medium">
              {region.label}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function SketchDiagram({
  data,
  compact,
}: {
  data: PlanSketchDiagramBlock["data"];
  compact?: boolean;
}) {
  const nodes = data.nodes.map((node, index) => ({
    ...node,
    x: node.x ?? 12 + index * (76 / Math.max(data.nodes.length - 1, 1)),
    y: node.y ?? 50,
  }));
  return (
    <div className="plan-sketch relative overflow-hidden rounded-[16px] border border-plan-line bg-plan-wireframe p-4">
      <svg
        viewBox="0 0 100 100"
        className={cn("w-full", compact ? "h-44" : "h-[340px]")}
        role="img"
      >
        {data.edges.map((edge, index) => {
          const from = nodes.find((node) => node.id === edge.from);
          const to = nodes.find((node) => node.id === edge.to);
          if (!from || !to) return null;
          return (
            <g key={`${edge.from}-${edge.to}-${index}`}>
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                className="stroke-primary"
                strokeDasharray="4 3"
                strokeLinecap="round"
                strokeWidth="1.4"
              />
              {edge.label && (
                <text
                  x={(from.x + to.x) / 2}
                  y={(from.y + to.y) / 2 - 4}
                  className="fill-primary text-[3px] font-semibold"
                  textAnchor="middle"
                >
                  {edge.label}
                </text>
              )}
            </g>
          );
        })}
        {nodes.map((node) => (
          <g key={node.id}>
            <rect
              x={node.x - 8}
              y={node.y - 7}
              width="16"
              height="14"
              rx="2.4"
              className="fill-plan-wireframe stroke-plan-sketch-line"
              strokeWidth="1.1"
            />
            <text
              x={node.x}
              y={node.y + 1}
              textAnchor="middle"
              className="fill-plan-sketch-line text-[3.2px] font-semibold"
            >
              {node.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
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
