import { useT } from "@agent-native/core/client/i18n";
import { IconPencil, IconX } from "@tabler/icons-react";
import {
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { Button } from "@/components/ui/button";

interface SpeakerNotesPanelProps {
  notes: string;
  onChange: (notes: string) => void;
  onClose: () => void;
  onGenerate: () => void;
  readOnly?: boolean;
}

const MIN_NOTES_HEIGHT = 120;
const MAX_NOTES_HEIGHT = 480;
const DEFAULT_NOTES_HEIGHT = 231;
const NOTES_HEIGHT_KEY_STEP = 24;

function clampNotesHeight(value: number) {
  return Math.min(MAX_NOTES_HEIGHT, Math.max(MIN_NOTES_HEIGHT, value));
}

function storeNotesHeight(value: number) {
  try {
    localStorage.setItem("speaker-notes-height", String(value));
    // coercion-ok: the height still applies for this session when storage is unavailable.
  } catch {}
}

export function SpeakerNotesPanel({
  notes,
  onChange,
  onClose,
  onGenerate,
  readOnly = false,
}: SpeakerNotesPanelProps) {
  const t = useT();
  const [height, setHeight] = useState(() => {
    try {
      const stored = Number(localStorage.getItem("speaker-notes-height"));
      return stored > 0 && Number.isFinite(stored)
        ? clampNotesHeight(stored)
        : DEFAULT_NOTES_HEIGHT;
    } catch {
      return DEFAULT_NOTES_HEIGHT;
    }
  });

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = height;
    let latestHeight = startHeight;
    const onMove = (moveEvent: PointerEvent) => {
      latestHeight = clampNotesHeight(startHeight + startY - moveEvent.clientY);
      setHeight(latestHeight);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      storeNotesHeight(latestHeight);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };

  const resizeWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const delta =
      event.key === "ArrowUp" ? NOTES_HEIGHT_KEY_STEP : -NOTES_HEIGHT_KEY_STEP;
    const nextHeight = clampNotesHeight(height + delta);
    setHeight(nextHeight);
    storeNotesHeight(nextHeight);
  };

  return (
    <section
      aria-label={t("speakerNotesPanel.title")}
      className="relative flex flex-shrink-0 flex-col border-t border-border bg-[var(--slides-editor-surface)]"
      style={{ height }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={t("speakerNotesPanel.resize")}
        aria-valuenow={height}
        aria-valuemin={MIN_NOTES_HEIGHT}
        aria-valuemax={MAX_NOTES_HEIGHT}
        tabIndex={0}
        className="group absolute inset-x-0 top-[-4px] z-10 flex h-2 cursor-row-resize items-center justify-center focus-visible:bg-primary/20 focus-visible:outline-none"
        onPointerDown={startResize}
        onKeyDown={resizeWithKeyboard}
      >
        <div className="h-0.5 w-[50px] rounded-full bg-muted-foreground/30 transition-colors group-hover:bg-muted-foreground/70" />
      </div>
      <div className="flex h-10 flex-shrink-0 items-center justify-between gap-2 px-4">
        <h2 className="text-sm font-medium text-foreground">
          {t("speakerNotesPanel.title")}
        </h2>
        <div className="flex items-center gap-3">
          {readOnly ? null : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-[22px] gap-1 px-2 text-xs"
              onClick={onGenerate}
            >
              <IconPencil className="size-3" aria-hidden />
              {notes.trim()
                ? t("speakerNotesPanel.rewrite")
                : t("speakerNotesPanel.generate")}
            </Button>
          )}
          <button
            type="button"
            aria-label={t("speakerNotesPanel.close")}
            onClick={onClose}
            className="inline-flex size-[22px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <IconX className="size-4" aria-hidden />
          </button>
        </div>
      </div>
      <textarea
        value={notes}
        onChange={(event) => onChange(event.target.value)}
        readOnly={readOnly}
        aria-label={t("speakerNotesPanel.title")}
        placeholder={readOnly ? undefined : t("speakerNotesPanel.placeholder")}
        className="min-h-0 flex-1 resize-none overflow-y-auto bg-transparent px-4 pb-3 pt-3 text-xs leading-relaxed text-muted-foreground outline-none placeholder:text-muted-foreground/70"
      />
    </section>
  );
}
