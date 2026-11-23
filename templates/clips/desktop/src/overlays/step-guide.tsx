import { useT } from "@agent-native/core/client/i18n";
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

const SCALE = 1.2;
const pt = (value: number) => `${value * SCALE}px`;
const ZOOM_STEP = 0.5;
const SAVE_DELAY_MS = 400;
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

function StepGuideSkeleton({ label }: { label: string }) {
  return (
    <div
      data-tw-surface
      role="status"
      aria-label={label}
      className="flex h-full flex-col bg-muted"
    >
      <header className="flex items-center gap-2 border-b border-border bg-background px-4 py-2">
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="flex-1" />
        <div className="h-8 w-24 animate-pulse rounded-md bg-muted" />
        <div className="h-8 w-20 animate-pulse rounded-md bg-muted" />
        <div className="h-8 w-28 animate-pulse rounded-md bg-muted" />
      </header>
      <main className="flex-1 overflow-hidden py-8">
        <div
          // guard:allow-raw-color — the page preview mirrors the exported PDF, which is theme-invariant.
          className="mx-auto bg-white shadow-md"
          style={{
            width: pt(612),
            padding: `${pt(14)} ${pt(612 - 576.5)} ${pt(28)} ${pt(27)}`,
          }}
        >
          <div
            // guard:allow-raw-color — placeholder on the theme-invariant page.
            className="animate-pulse rounded bg-zinc-200"
            style={{ height: pt(30), width: "60%" }}
          />
          <div
            // guard:allow-raw-color — placeholder on the theme-invariant page.
            className="animate-pulse rounded bg-zinc-200"
            style={{ height: pt(12), width: "35%", marginTop: pt(16) }}
          />
          {[0, 1].map((step) => (
            <div key={step} style={{ marginTop: pt(28) }}>
              <div className="flex items-center" style={{ gap: pt(15) }}>
                <div
                  // guard:allow-raw-color — placeholder on the theme-invariant page.
                  className="shrink-0 animate-pulse rounded-full bg-zinc-200"
                  style={{
                    width: pt(26.5),
                    height: pt(26.5),
                    marginLeft: pt(5),
                  }}
                />
                <div
                  // guard:allow-raw-color — placeholder on the theme-invariant page.
                  className="animate-pulse rounded bg-zinc-200"
                  style={{ height: pt(14), width: "50%" }}
                />
              </div>
              <div
                // guard:allow-raw-color — placeholder on the theme-invariant page.
                className="animate-pulse rounded-[3px] bg-zinc-200"
                style={{
                  marginTop: pt(8),
                  marginLeft: pt(28),
                  width: FRAME_WIDTH * SCALE + 4,
                  height: FRAME_HEIGHT * SCALE + 4,
                }}
              />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

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

export function StepGuideEditor({
  sessionId,
}: {
  sessionId?: string | undefined;
}) {
  const t = useT();
  const [loaded, setLoaded] = useState<LoadedGuide | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const saveTimer = useRef<number | undefined>(undefined);
  const pending = useRef<StepGuide | null>(null);
  const discardOnClose = useRef(false);
  const saving = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!sessionId) {
      setStatus({ kind: "error", text: t("stepGuide.noSession") });
      return;
    }
    invoke<LoadedGuide>("step_guide_load", { sessionId })
      .then(setLoaded)
      .catch((error) => setStatus({ kind: "error", text: errorText(error) }));
  }, [sessionId, t]);

  const flush = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    const save = saving.current
      .catch(() => undefined)
      .then(async () => {
        while (pending.current && sessionId) {
          const guide = pending.current;
          await invoke("step_guide_save", { sessionId, guide });
          if (pending.current === guide) pending.current = null;
        }
      });
    saving.current = save;
    return save;
  }, [sessionId]);

  useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested(async (event) => {
      if (discardOnClose.current) return;
      try {
        await flush();
      } catch (error) {
        event.preventDefault();
        discardOnClose.current = true;
        setStatus({
          kind: "error",
          text: t("stepGuide.closeToDiscard", { error: errorText(error) }),
        });
      }
    });
    return () => void unlisten.then((stop) => stop());
  }, [flush, t]);

  const update = (change: (guide: StepGuide) => StepGuide) => {
    setLoaded((current) => {
      if (!current) return current;
      const guide = change(current.guide);
      pending.current = guide;
      discardOnClose.current = false;
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
    run(t("stepGuide.exporting"), async () => {
      const path = await invoke<string>("step_guide_export_pdf", { sessionId });
      await invoke("step_guide_open", { sessionId, path });
      return t("stepGuide.exported", { file: path.split("/").pop() ?? path });
    });

  const share = () =>
    run(t("stepGuide.uploading"), async () => {
      const { uploaded, total } = await invoke<ShareSummary>(
        "step_guide_share",
        { sessionId },
      );
      return uploaded === total
        ? t("stepGuide.uploaded")
        : t("stepGuide.uploadedPartly", { uploaded, total });
    });

  const reveal = () =>
    run(t("stepGuide.openingFolder"), async () => {
      await invoke("step_guide_open", { sessionId, path: null });
    });

  if (!loaded && status.kind === "error") {
    return (
      <div
        data-tw-surface
        role="alert"
        className="flex h-full items-center justify-center bg-muted text-sm text-muted-foreground"
      >
        {status.text}
      </div>
    );
  }

  if (!loaded) return <StepGuideSkeleton label={t("stepGuide.loading")} />;

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
          {t("stepGuide.editorTitle")}
        </span>
        <span className="flex-1 truncate text-xs text-muted-foreground">
          {status.kind === "idle" ? t("stepGuide.autosave") : status.text}
        </span>
        <button
          type="button"
          onClick={() => void reveal()}
          disabled={busy}
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm text-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50 [&_svg]:size-4"
        >
          <IconFolder /> {t("stepGuide.showFiles")}
        </button>
        <button
          type="button"
          onClick={() => void share()}
          disabled={busy}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input px-3 text-sm text-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50 [&_svg]:size-4"
        >
          <IconShare /> {t("stepGuide.share")}
        </button>
        <button
          type="button"
          onClick={() => void exportPdf()}
          disabled={busy}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 [&_svg]:size-4"
        >
          <IconFileTypePdf /> {t("stepGuide.exportPdf")}
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
            placeholder={t("stepGuide.untitled")}
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
                        label={t("stepGuide.zoomOut")}
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
                        label={t("stepGuide.zoomIn")}
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
                    label={t("stepGuide.moveUp")}
                    disabled={index === 0}
                    onClick={() =>
                      updateItems((items) => moveItem(items, index, -1))
                    }
                  >
                    <IconArrowUp />
                  </ToolButton>
                  <ToolButton
                    label={t("stepGuide.moveDown")}
                    disabled={index === guide.items.length - 1}
                    onClick={() =>
                      updateItems((items) => moveItem(items, index, 1))
                    }
                  >
                    <IconArrowDown />
                  </ToolButton>
                  <ToolButton
                    label={t("stepGuide.addNote")}
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
                    label={
                      item.kind === "step"
                        ? t("stepGuide.deleteStep")
                        : t("stepGuide.deleteNote")
                    }
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
                        placeholder={t("stepGuide.describeStep")}
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
                    placeholder={t("stepGuide.writeNote")}
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
