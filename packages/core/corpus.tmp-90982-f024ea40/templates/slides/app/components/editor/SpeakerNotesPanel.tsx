import { useT } from "@agent-native/core/client";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import { useState, type PointerEvent as ReactPointerEvent } from "react";

interface SpeakerNotesPanelProps {
  notes: string;
  onChange: (notes: string) => void;
  slideIndex: number;
  slideCount: number;
}

const MIN_NOTES_HEIGHT = 72;
const MAX_NOTES_HEIGHT = 260;
const DEFAULT_NOTES_HEIGHT = 112;

function clampNotesHeight(value: number) {
  return Math.min(MAX_NOTES_HEIGHT, Math.max(MIN_NOTES_HEIGHT, value));
}

export function SpeakerNotesPanel({
  notes,
  onChange,
  slideIndex,
  slideCount,
}: SpeakerNotesPanelProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem("speaker-notes-expanded") !== "false";
    } catch {
      return true;
    }
  });
  const [height, setHeight] = useState(() => {
    try {
      const stored = Number(localStorage.getItem("speaker-notes-height"));
      return Number.isFinite(stored)
        ? clampNotesHeight(stored)
        : DEFAULT_NOTES_HEIGHT;
    } catch {
      return DEFAULT_NOTES_HEIGHT;
    }
  });

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    try {
      localStorage.setItem("speaker-notes-expanded", String(next));
    } catch {}
  };

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!expanded) return;
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
      try {
        localStorage.setItem("speaker-notes-height", String(latestHeight));
      } catch {}
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };

  return (
    <div className="flex-shrink-0 border-t border-border bg-background">
      {expanded && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={t("raw.speakerNotes")}
          className="group flex h-2 cursor-row-resize items-center justify-center"
          onPointerDown={startResize}
        >
          <div className="h-px w-10 rounded-full bg-border transition-colors group-hover:bg-muted-foreground/70" />
        </div>
      )}
      <button
        onClick={toggle}
        className="flex w-full cursor-pointer items-center justify-between px-4 py-1.5"
      >
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          {t("raw.speakerNotesForSlide", {
            index: slideIndex + 1,
            count: slideCount,
          })}
        </span>
        {expanded ? (
          <IconChevronDown className="w-3 h-3 text-muted-foreground" />
        ) : (
          <IconChevronUp className="w-3 h-3 text-muted-foreground" />
        )}
      </button>
      {expanded && (
        <div className="px-4 pb-3" style={{ height }}>
          <textarea
            value={notes || ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={t("raw.addSpeakerNotes")}
            className="h-full w-full resize-none bg-transparent font-mono text-xs text-muted-foreground outline-none placeholder:text-muted-foreground/70"
          />
        </div>
      )}
    </div>
  );
}
