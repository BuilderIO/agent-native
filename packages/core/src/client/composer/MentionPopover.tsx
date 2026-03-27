import React, {
  useState,
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
} from "react";
import { createPortal } from "react-dom";
import type { FileResult, SkillResult } from "./types.js";

export interface MentionPopoverRef {
  moveUp: () => void;
  moveDown: () => void;
  getSelectedIndex: () => number;
}

interface MentionPopoverProps {
  type: "@" | "/";
  position: { top: number; left: number } | null;
  files: FileResult[];
  skills: SkillResult[];
  hint?: string;
  isLoading: boolean;
  query: string;
  onSelectFile: (file: FileResult) => void;
  onSelectSkill: (skill: SkillResult) => void;
  onClose: () => void;
}

// Simple inline SVG icons
function FileIconSmall() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-muted-foreground"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function FolderIconSmall() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-muted-foreground"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function SkillIconSmall() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-muted-foreground"
    >
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  );
}

function HintWithLink({ hint }: { hint: string }) {
  // If hint contains a URL, split it and render the URL as a link
  const urlMatch = hint.match(/(https?:\/\/\S+)/);
  if (!urlMatch) return <>{hint}</>;
  const before = hint.slice(0, urlMatch.index);
  const url = urlMatch[1];
  return (
    <>
      {before}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-foreground"
      >
        Learn more
      </a>
    </>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-1 p-1">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-2 rounded px-2 py-1.5">
          <div className="h-3.5 w-3.5 rounded bg-muted animate-pulse" />
          <div
            className="h-3 rounded bg-muted animate-pulse"
            style={{ width: `${60 + i * 20}px` }}
          />
        </div>
      ))}
    </div>
  );
}

export const MentionPopover = forwardRef<
  MentionPopoverRef,
  MentionPopoverProps
>(function MentionPopover(props, ref) {
  const {
    type,
    position,
    files,
    skills,
    hint,
    isLoading,
    query,
    onSelectFile,
    onSelectSkill,
    onClose,
  } = props;

  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const items = type === "@" ? files : skills;
  const itemCount = items.length;

  // Reset selection when items change
  useEffect(() => {
    setSelectedIndex(0);
  }, [items, query]);

  // Scroll selected item into view
  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const selected = container.children[selectedIndex] as
      | HTMLElement
      | undefined;
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  useImperativeHandle(ref, () => ({
    moveUp: () => {
      setSelectedIndex((prev) =>
        prev <= 0 ? Math.max(0, itemCount - 1) : prev - 1,
      );
    },
    moveDown: () => {
      setSelectedIndex((prev) => (prev >= itemCount - 1 ? 0 : prev + 1));
    },
    getSelectedIndex: () => selectedIndex,
  }));

  if (!position) return null;

  const content = (
    <>
      {/* Backdrop to capture outside clicks */}
      <div className="fixed inset-0 z-[9998]" onClick={onClose} />
      <div
        className="fixed z-[9999] w-[320px] max-h-[320px] overflow-y-auto rounded-lg border border-border bg-popover shadow-lg"
        style={{
          bottom: `calc(100vh - ${position.top}px + 4px)`,
          left: Math.max(8, Math.min(position.left, window.innerWidth - 336)),
        }}
      >
        {isLoading && itemCount === 0 ? (
          <LoadingSkeleton />
        ) : itemCount === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">
            {type === "@" ? (
              query ? (
                "No files found"
              ) : (
                "Type to search files..."
              )
            ) : hint ? (
              <HintWithLink hint={hint} />
            ) : (
              "No skills available"
            )}
          </div>
        ) : (
          <div ref={listRef} className="p-1">
            {type === "@"
              ? (files as FileResult[]).map((file, i) => (
                  <button
                    key={file.path}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                      i === selectedIndex
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent/50"
                    }`}
                    onMouseEnter={() => setSelectedIndex(i)}
                    onClick={() => onSelectFile(file)}
                  >
                    {file.type === "folder" ? (
                      <FolderIconSmall />
                    ) : (
                      <FileIconSmall />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">
                        {file.name}
                      </span>
                      {file.path !== file.name && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {file.path}
                        </span>
                      )}
                    </span>
                    {file.source === "resource" && (
                      <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                        resource
                      </span>
                    )}
                  </button>
                ))
              : (skills as SkillResult[]).map((skill, i) => (
                  <button
                    key={skill.path}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                      i === selectedIndex
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent/50"
                    }`}
                    onMouseEnter={() => setSelectedIndex(i)}
                    onClick={() => onSelectSkill(skill)}
                  >
                    <SkillIconSmall />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">
                        {skill.name}
                      </span>
                      {skill.description && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {skill.description}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
          </div>
        )}
      </div>
    </>
  );

  return createPortal(content, document.body);
});
