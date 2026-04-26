import { useState } from "react";
import { IconChevronUp, IconChevronDown } from "@tabler/icons-react";

interface SpeakerNotesPanelProps {
  notes: string;
  onChange: (notes: string) => void;
  slideIndex: number;
  slideCount: number;
}

export function SpeakerNotesPanel({
  notes,
  onChange,
  slideIndex,
  slideCount,
}: SpeakerNotesPanelProps) {
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem("speaker-notes-expanded") !== "false";
    } catch {
      return true;
    }
  });

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    try {
      localStorage.setItem("speaker-notes-expanded", String(next));
    } catch {}
  };

  return (
    <div className="border-t border-white/[0.06] bg-[hsl(240,5%,6%)] flex-shrink-0">
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between px-4 py-1.5 cursor-pointer"
      >
        <span className="text-[10px] font-medium text-white/30 uppercase tracking-wider">
          Speaker Notes — Slide {slideIndex + 1} / {slideCount}
        </span>
        {expanded ? (
          <IconChevronDown className="w-3 h-3 text-white/30" />
        ) : (
          <IconChevronUp className="w-3 h-3 text-white/30" />
        )}
      </button>
      {expanded && (
        <div className="px-4 pb-3">
          <textarea
            value={notes || ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Add speaker notes..."
            className="w-full h-20 bg-transparent text-white/50 text-xs font-mono placeholder:text-white/20 resize-none outline-none"
          />
        </div>
      )}
    </div>
  );
}
