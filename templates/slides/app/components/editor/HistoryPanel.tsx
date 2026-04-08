import { useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { IconHistory } from "@tabler/icons-react";
import { useDecks, type HistoryEntry } from "@/context/DeckContext";

interface HistoryPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef?: React.RefObject<HTMLButtonElement | null>;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const secs = Math.floor(diff / 1000);
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

export default function HistoryPanel({
  open,
  onOpenChange,
  anchorRef,
}: HistoryPanelProps) {
  const { history, historyIndex, restoreFromHistory } = useDecks();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        anchorRef?.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onOpenChange(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, onOpenChange, anchorRef]);

  if (!open || !anchorRef?.current) return null;

  const rect = anchorRef.current.getBoundingClientRect();
  const vw = window.innerWidth;
  const panelWidth = Math.min(300, vw - 16);
  const left = Math.max(
    8,
    Math.min(rect.right - panelWidth, vw - panelWidth - 8),
  );

  return createPortal(
    <div
      ref={panelRef}
      className="fixed rounded-lg border border-white/[0.08] bg-[hsl(240,5%,8%)] shadow-2xl z-[200]"
      style={{ top: rect.bottom + 6, left, width: panelWidth }}
    >
      <div className="px-3 py-2.5 border-b border-white/[0.06] flex items-center gap-2">
        <IconHistory className="w-4 h-4 text-[#609FF8]" />
        <span className="text-xs font-medium text-white/80">
          Edit IconHistory
        </span>
        <span className="text-[10px] text-white/30 ml-auto">
          Cmd+Z / Cmd+Shift+Z
        </span>
      </div>

      <div className="overflow-y-auto max-h-[50vh] p-1">
        {history.length === 0 && (
          <p className="text-xs text-white/30 text-center py-4">
            No history yet
          </p>
        )}
        {[...history].reverse().map((entry, reversedIdx) => {
          const realIdx = history.length - 1 - reversedIdx;
          const isCurrent = realIdx === historyIndex;

          return (
            <button
              key={`${entry.timestamp}-${realIdx}`}
              onClick={() => {
                restoreFromHistory(realIdx);
                onOpenChange(false);
              }}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left transition-colors ${
                isCurrent ? "bg-[#609FF8]/10" : "hover:bg-white/[0.04]"
              }`}
            >
              <div
                className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  isCurrent
                    ? "bg-[#609FF8]"
                    : realIdx < historyIndex
                      ? "bg-white/20"
                      : "bg-white/10"
                }`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-xs font-medium truncate ${
                      isCurrent ? "text-[#609FF8]" : "text-white/60"
                    }`}
                  >
                    {entry.label}
                  </span>
                  {isCurrent && (
                    <span className="text-[9px] px-1 py-0.5 rounded bg-[#609FF8]/20 text-[#609FF8] font-medium flex-shrink-0">
                      Current
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-white/25">
                  {timeAgo(entry.timestamp)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
