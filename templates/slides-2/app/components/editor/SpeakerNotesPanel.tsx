import { useT } from "@agent-native/core/client/i18n";
import { appStorageKey } from "@shared/app-storage";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import { useState, type PointerEvent as ReactPointerEvent } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface SpeakerNotesPanelProps {
  notes: string;
  onChange: (notes: string) => void;
  readOnly?: boolean;
}

const MIN_NOTES_HEIGHT = 72;
const MAX_NOTES_HEIGHT = 260;
const DEFAULT_NOTES_HEIGHT = 112;
const NOTES_EXPANDED_STORAGE_KEY = appStorageKey("speaker-notes-expanded");
const NOTES_HEIGHT_STORAGE_KEY = appStorageKey("speaker-notes-height");

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
      return localStorage.getItem(NOTES_EXPANDED_STORAGE_KEY) === "true";
    } catch {
      // coercion-ok: browser storage is optional; the collapsed state is the default.
      return false;
    }
  });
  const [height, setHeight] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(NOTES_HEIGHT_STORAGE_KEY));
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
      localStorage.setItem(NOTES_EXPANDED_STORAGE_KEY, String(next));
    } catch {
      // coercion-ok: The current React state remains authoritative when browser storage is unavailable.
    }
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
        localStorage.setItem(NOTES_HEIGHT_STORAGE_KEY, String(latestHeight));
      } catch {
        // coercion-ok: The resized height applies now even when it cannot persist across reloads.
      }
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
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={toggle}
        className="group h-auto w-full cursor-pointer justify-between px-4 py-1.5 text-left font-normal hover:bg-transparent active:scale-100"
      >
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider transition-colors group-hover:text-foreground/80">
          {t("raw.speakerNotes")}
        </span>
        {expanded ? (
          <IconChevronDown className="w-3 h-3 text-muted-foreground" />
        ) : (
          <IconChevronUp className="w-3 h-3 text-muted-foreground" />
        )}
      </Button>
      {expanded && (
        <div className="px-4 pb-3" style={{ height }}>
          <Textarea
            value={notes || ""}
            onChange={(e) => onChange(e.target.value)}
            readOnly={readOnly}
            placeholder={readOnly ? undefined : t("raw.addSpeakerNotes")}
            className="h-full min-h-0 w-full resize-none rounded-none border-0 bg-transparent p-0 font-mono text-xs text-muted-foreground shadow-none outline-none placeholder:text-muted-foreground/70 focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>
      )}
    </div>
  );
}
