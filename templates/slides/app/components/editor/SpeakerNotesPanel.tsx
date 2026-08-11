import { useT } from "@agent-native/core/client/i18n";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import { useState, type PointerEvent as ReactPointerEvent } from "react";

interface SpeakerNotesPanelProps {
  notes: string;
  onChange: (notes: string) => void;
  readOnly?: boolean;
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
  readOnly = false,
}: SpeakerNotesPanelProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem("speaker-notes-expanded") === "true";
    } catch {
      // coercion-ok: browser storage is optional; the collapsed state is the default.
      return false;
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
    <div className="flex-shrink-0 bg-[var(--slides-editor-surface)]">
      {expanded && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={t("raw.speakerNotes")}
          className="group flex h-2 cursor-row-resize items-center justify-center"
          onPointerDown={startResize}
        >
          <div className="h-px w-10 rounded-full bg-muted-foreground/30 transition-colors group-hover:bg-muted-foreground/70" />
        </div>
      )}
      <button
        onClick={toggle}
        className="flex w-full cursor-pointer items-center justify-between px-4 py-1.5"
      >
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          {t("raw.speakerNotes")}
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
            readOnly={readOnly}
            placeholder={readOnly ? undefined : t("raw.addSpeakerNotes")}
            className="h-full w-full resize-none bg-transparent font-mono text-xs text-muted-foreground outline-none placeholder:text-muted-foreground/70"
          />
        </div>
      )}
    </div>
  );
}
