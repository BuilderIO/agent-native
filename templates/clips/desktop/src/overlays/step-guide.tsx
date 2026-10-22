import {
  IconArrowDown,
  IconArrowUp,
  IconFileTypePdf,
  IconFolder,
  IconNote,
  IconShare,
  IconTrash,
  IconZoomIn,
  IconZoomOut,
} from "@tabler/icons-react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  FRAME_HEIGHT,
  FRAME_WIDTH,
  MAX_ZOOM,
  MIN_ZOOM,
  moveItem,
  setZoom,
  stepNumbers,
  visibleRect,
  type GuideImage,
  type GuideItem,
  type LoadedGuide,
  type StepGuide,
} from "./step-guide-model";

// One PDF point in CSS pixels, so the page reads at a comfortable size.
const SCALE = 1.2;
const pt = (value: number) => `${value * SCALE}px`;
const ZOOM_STEP = 0.5;
const SAVE_DELAY_MS = 400;
// The page preview mirrors the exported PDF, so it keeps the PDF palette in
// every theme.
const TEXT_COLOR = "#515151"; // guard:allow-raw-color — PDF body text colour.
const BADGE_COLOR = "#E10992"; // guard:allow-raw-color — PDF step badge colour.

function fileUrl(directory: string, fileName: string): string {
  return convertFileSrc(`${directory}/${fileName}`);
}

function byline(guide: StepGuide): string {
  const count = guide.items.filter((item) => item.kind === "step").length;
  return [
    guide.author,
    count === 1 ? "1 step" : `${count} steps`,
    guide.duration,
  ]
    .filter(Boolean)
    .join(" | ");
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A step's screenshot inside its frame, as the PDF draws it. */
function StepFrame({
  directory,
  image,
}: {
  directory: string;
  image: GuideImage;
}) {
  const visible = visibleRect(image);
  const frameWidth = FRAME_WIDTH * SCALE;
  const scale = frameWidth / visible.width;
  const place = (x: number, y: number) => ({
    left: (x - visible.x) * scale,
    top: (y - visible.y) * scale,
  });
  const click = place(image.click.x, image.click.y);
  const ring = 48 * SCALE;
  const drag = image.dragTo ? place(image.dragTo.x, image.dragTo.y) : null;
  return (
    <div
      // guard:allow-raw-color — the page preview mirrors the exported PDF, which is theme-invariant.
      className="relative overflow-hidden rounded-[3px] border-2 border-white"
      style={{
        width: frameWidth + 4,
        height: FRAME_HEIGHT * SCALE + 4,
        boxShadow: "3px 3.5px 8px rgba(0, 0, 0, 0.17)", // guard:allow-raw-color — PDF frame shadow.
      }}
    >
      <img
        alt=""
        draggable={false}
        src={fileUrl(directory, image.fileName)}
        className="absolute max-w-none select-none"
        style={{
          left: -visible.x * scale,
          top: -visible.y * scale,
          width: image.width * scale,
          height: image.height * scale,
        }}
      />
      <svg
        className="pointer-events-none absolute inset-0"
        width={frameWidth}
        height={FRAME_HEIGHT * SCALE}
      >
        {drag ? (
          <>
            <line
              x1={click.left}
              y1={click.top}
              x2={drag.left}
              y2={drag.top}
              // guard:allow-raw-color — click marker matches the PDF.
              stroke="#ffff00"
              strokeWidth={3 * SCALE}
            />
            <circle
              cx={drag.left}
              cy={drag.top}
              r={ring / 2 - SCALE}
              // guard:allow-raw-color — click marker matches the PDF.
              fill="rgba(255,255,0,0.4)"
              // guard:allow-raw-color — click marker matches the PDF.
              stroke="#ffff00"
              strokeWidth={2 * SCALE}
            />
          </>
        ) : null}
        <circle
          cx={click.left}
          cy={click.top}
          r={ring / 2 - SCALE}
          // guard:allow-raw-color — click marker matches the PDF.
          fill="rgba(255,255,0,0.4)"
          // guard:allow-raw-color — click marker matches the PDF.
          stroke="#ffff00"
          strokeWidth={2 * SCALE}
        />
      </svg>
      {image.cursor ? (
        <img
          alt=""
          draggable={false}
          src={fileUrl(directory, image.cursor.fileName)}
          className="pointer-events-none absolute max-w-none"
          style={{
            left: click.left - image.cursor.hotspot.x * scale,
            top: click.top - image.cursor.hotspot.y * scale,
            width: image.cursor.width * scale,
            height: image.cursor.height * scale,
          }}
        />
      ) : null}
    </div>
  );
}

function ToolButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-30 [&_svg]:size-4"
    >
      {children}
    </button>
  );
}

/** A textarea that grows with its text, styled like the PDF line. */
function GrowingText({
  value,
  onChange,
  placeholder,
  className,
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className={`w-full resize-none overflow-hidden rounded border border-transparent bg-transparent outline-none hover:border-border focus:border-ring ${className ?? ""}`}
      style={{ color: TEXT_COLOR, fontFamily: "Arial, sans-serif", ...style }}
    />
  );
}

/** What `step_guide_share` reports, so a partial upload never reads as done. */
interface ShareSummary {
  folderUrl: string;
  uploaded: number;
  total: number;
}

type Status =
  | { kind: "idle" }
  | { kind: "busy"; text: string }
  | { kind: "done"; text: string }
  | { kind: "error"; text: string };

export function StepGuideEditor({ sessionId }: { sessionId?: string }) {
  const [loaded, setLoaded] = useState<LoadedGuide | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const saveTimer = useRef<number | undefined>(undefined);
  const pending = useRef<StepGuide | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setStatus({ kind: "error", text: "No step capture was named." });
      return;
    }
    invoke<LoadedGuide>("step_guide_load", { sessionId })
      .then(setLoaded)
      .catch((error) => setStatus({ kind: "error", text: errorText(error) }));
  }, [sessionId]);

  const flush = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    const guide = pending.current;
    if (!guide || !sessionId) return;
    pending.current = null;
    await invoke("step_guide_save", { sessionId, guide });
  }, [sessionId]);

  // Tauri waits for this handler before it closes the window, so the last
  // edit is saved. If that save fails the window stays open to show why; a
  // second close goes through.
  useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested(async (event) => {
      try {
        await flush();
      } catch (error) {
        event.preventDefault();
        setStatus({ kind: "error", text: errorText(error) });
      }
    });
    return () => void unlisten.then((stop) => stop());
  }, [flush]);

  const update = (change: (guide: StepGuide) => StepGuide) => {
    setLoaded((current) => {
      if (!current) return current;
      const guide = change(current.guide);
      pending.current = guide;
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        flush().catch((error) =>
          setStatus({ kind: "error", text: errorText(error) }),
        );
      }, SAVE_DELAY_MS);
      return { ...current, guide };
    });
  };

  const updateItems = (change: (items: GuideItem[]) => GuideItem[]) =>
    update((guide) => ({ ...guide, items: change(guide.items) }));

  const updateItem = (id: string, change: (item: GuideItem) => GuideItem) =>
    updateItems((items) =>
      items.map((item) => (item.id === id ? change(item) : item)),
    );

  const run = async (busy: string, work: () => Promise<string | void>) => {
    setStatus({ kind: "busy", text: busy });
    try {
      await flush();
      const done = await work();
      setStatus(done ? { kind: "done", text: done } : { kind: "idle" });
    } catch (error) {
      setStatus({ kind: "error", text: errorText(error) });
    }
  };

  const exportPdf = () =>
    run("Exporting PDF…", async () => {
      const path = await invoke<string>("step_guide_export_pdf", { sessionId });
      await invoke("step_guide_open", { sessionId, path });
      return `Saved ${path.split("/").pop()} to Downloads`;
    });

  const share = () =>
    run("Uploading to Clips…", async () => {
      const { uploaded, total } = await invoke<ShareSummary>(
        "step_guide_share",
        { sessionId },
      );
      return uploaded === total
        ? "Uploaded to your Clips library"
        : `Uploaded ${uploaded} of ${total} steps to your Clips library`;
    });

  const reveal = () =>
    run("Opening folder…", async () => {
      await invoke("step_guide_open", { sessionId, path: null });
    });

  if (!loaded) {
    return (
      <div
        data-tw-surface
        className="flex h-full items-center justify-center bg-muted text-sm text-muted-foreground"
      >
        {status.kind === "error" ? status.text : "Loading step guide…"}
      </div>
    );
  }

  const { guide, directory } = loaded;
  const numbers = stepNumbers(guide.items);
  const busy = status.kind === "busy";

  return (
    <div
      data-tw-surface
      className="flex h-full flex-col bg-muted text-foreground"
    >
      <header className="flex items-center gap-2 border-b border-border bg-background px-4 py-2">
        <span className="text-sm font-semibold text-foreground">
          Step guide
        </span>
        <span className="flex-1 truncate text-xs text-muted-foreground">
          {status.kind === "idle" ? "Edits save automatically" : status.text}
        </span>
        <button
          type="button"
          onClick={reveal}
          disabled={busy}
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm text-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50 [&_svg]:size-4"
        >
          <IconFolder /> Show files
        </button>
        <button
          type="button"
          onClick={share}
          disabled={busy}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input px-3 text-sm text-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50 [&_svg]:size-4"
        >
          <IconShare /> Share
        </button>
        <button
          type="button"
          onClick={exportPdf}
          disabled={busy}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 [&_svg]:size-4"
        >
          <IconFileTypePdf /> Export PDF
        </button>
      </header>
      <main className="flex-1 overflow-y-auto py-8">
        <article
          // guard:allow-raw-color — the page preview mirrors the exported PDF, which is theme-invariant.
          className="mx-auto bg-white shadow-md"
          style={{
            width: pt(612),
            padding: `${pt(14)} ${pt(612 - 576.5)} ${pt(28)} ${pt(27)}`,
            fontFamily: "Arial, sans-serif",
            color: TEXT_COLOR,
          }}
        >
          <GrowingText
            value={guide.title}
            onChange={(title) => update((current) => ({ ...current, title }))}
            placeholder="Untitled guide"
            className="font-bold"
            style={{ fontSize: pt(24), lineHeight: 1.25 }}
          />
          <div
            className="flex justify-between gap-4 px-px"
            style={{ fontSize: pt(12), marginTop: pt(16) }}
          >
            <span>{byline(guide)}</span>
            <span>{guide.date}</span>
          </div>
          <div style={{ marginTop: pt(20) }}>
            {guide.items.map((item, index) => (
              <section
                key={item.id}
                className="group relative"
                style={{
                  marginLeft: pt(-27),
                  padding: `0 0 ${pt(28)} ${pt(27)}`,
                }}
              >
                <div className="absolute top-0 right-0 z-10 flex gap-0.5 rounded-md bg-popover/90 p-0.5 opacity-0 shadow-sm ring-1 ring-border transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                  {item.kind === "step" && item.image ? (
                    <>
                      <ToolButton
                        label="Zoom out"
                        disabled={item.image.zoom <= MIN_ZOOM}
                        onClick={() =>
                          updateItem(item.id, (current) =>
                            current.kind === "step" && current.image
                              ? setZoom(current, current.image.zoom - ZOOM_STEP)
                              : current,
                          )
                        }
                      >
                        <IconZoomOut />
                      </ToolButton>
                      <ToolButton
                        label="Zoom in"
                        disabled={item.image.zoom >= MAX_ZOOM}
                        onClick={() =>
                          updateItem(item.id, (current) =>
                            current.kind === "step" && current.image
                              ? setZoom(current, current.image.zoom + ZOOM_STEP)
                              : current,
                          )
                        }
                      >
                        <IconZoomIn />
                      </ToolButton>
                    </>
                  ) : null}
                  <ToolButton
                    label="Move up"
                    disabled={index === 0}
                    onClick={() =>
                      updateItems((items) => moveItem(items, index, -1))
                    }
                  >
                    <IconArrowUp />
                  </ToolButton>
                  <ToolButton
                    label="Move down"
                    disabled={index === guide.items.length - 1}
                    onClick={() =>
                      updateItems((items) => moveItem(items, index, 1))
                    }
                  >
                    <IconArrowDown />
                  </ToolButton>
                  <ToolButton
                    label="Add a note below"
                    onClick={() =>
                      updateItems((items) => {
                        const next = items.slice();
                        next.splice(index + 1, 0, {
                          kind: "note",
                          id: `note-${Date.now()}`,
                          text: "",
                        });
                        return next;
                      })
                    }
                  >
                    <IconNote />
                  </ToolButton>
                  <ToolButton
                    label={item.kind === "step" ? "Delete step" : "Delete note"}
                    onClick={() =>
                      updateItems((items) =>
                        items.filter((current) => current.id !== item.id),
                      )
                    }
                  >
                    <IconTrash />
                  </ToolButton>
                </div>
                {item.kind === "step" ? (
                  <>
                    <div className="flex items-start" style={{ gap: pt(15) }}>
                      <span
                        // guard:allow-raw-color — the page preview mirrors the exported PDF, which is theme-invariant.
                        className="flex shrink-0 items-center justify-center rounded-full text-white"
                        style={{
                          width: pt(26.5),
                          height: pt(26.5),
                          marginLeft: pt(5),
                          marginTop: pt(6.5),
                          background: BADGE_COLOR,
                          fontSize: pt(17),
                        }}
                      >
                        {numbers.get(item.id)}
                      </span>
                      <GrowingText
                        value={item.text}
                        onChange={(text) =>
                          updateItem(item.id, (current) => ({
                            ...current,
                            text,
                          }))
                        }
                        placeholder="Describe this step"
                        style={{
                          fontSize: pt(14),
                          lineHeight: 1.3,
                          marginTop: pt(9),
                          width: pt(482),
                        }}
                      />
                    </div>
                    {item.image ? (
                      <div style={{ marginTop: pt(8), marginLeft: pt(28) }}>
                        <StepFrame directory={directory} image={item.image} />
                      </div>
                    ) : null}
                  </>
                ) : (
                  <GrowingText
                    value={item.text}
                    onChange={(text) =>
                      updateItem(item.id, (current) => ({ ...current, text }))
                    }
                    placeholder="Write a note"
                    // guard:allow-raw-color — the page preview mirrors the exported PDF, which is theme-invariant.
                    className="bg-zinc-50"
                    style={{
                      fontSize: pt(14),
                      lineHeight: 1.3,
                      padding: pt(8),
                    }}
                  />
                )}
              </section>
            ))}
          </div>
        </article>
      </main>
    </div>
  );
}
