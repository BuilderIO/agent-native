import { useT } from "@agent-native/core/client/i18n";
import { SharedRichEditor } from "@agent-native/toolkit/editor";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

interface CanvasEditorProps {
  view: "user" | "ai";
  userNotesMd?: string;
  onUserNotesChange?: (next: string) => void;
  summaryMd?: string;
  bullets?: string[];
  onSummaryChange?: (next: string) => void;
  renderBullet?: (bullet: string, index: number) => React.ReactNode;
  readOnly?: boolean;
  className?: string;
}

export function CanvasEditor({
  view,
  userNotesMd = "",
  onUserNotesChange,
  summaryMd = "",
  bullets = [],
  onSummaryChange,
  renderBullet,
  readOnly = false,
  className,
}: CanvasEditorProps) {
  const t = useT();
  const showUser = view === "user";
  const showAi = view === "ai";
  const hasAi = summaryMd || bullets.length > 0;

  return (
    <div className={cn("px-6 py-6 space-y-6 max-w-2xl", className)}>
      {/* User notes block */}
      {showUser && (
        <UserNotesBlock
          value={userNotesMd}
          onChange={onUserNotesChange ?? (() => {})}
          readOnly={readOnly}
        />
      )}

      {/* AI summary */}
      {showAi && summaryMd && (
        <AiSummaryBlock
          value={summaryMd}
          onChange={onSummaryChange ?? (() => {})}
          readOnly={readOnly}
        />
      )}

      {/* AI bullets — muted gray, with optional BulletLink wrappers */}
      {showAi && bullets.length > 0 && (
        <AiBulletsBlock bullets={bullets} renderBullet={renderBullet} />
      )}

      {/* Empty state when AI notes haven't been generated yet */}
      {showAi && !hasAi && (
        <p className="text-sm leading-relaxed text-muted-foreground/50 italic">
          {t("meetingCanvas.noAiNotes")}
        </p>
      )}
    </div>
  );
}


function UserNotesBlock({
  value,
  onChange,
  readOnly = false,
}: {
  value: string;
  onChange: (next: string) => void;
  readOnly?: boolean;
}) {
  const t = useT();

  if (readOnly && !value) {
    return (
      <p className="text-sm leading-relaxed text-muted-foreground/50 italic">
        {t("meetingCanvas.noNotes")}
      </p>
    );
  }

  return (
    <RichContentBlock
      value={value}
      onChange={onChange}
      readOnly={readOnly}
      placeholder={t("meetingCanvas.yourNotes")}
      ariaLabel={t("meetingDetail.myNotes")}
      editorClassName="text-base leading-relaxed font-medium"
    />
  );
}


function AiSummaryBlock({
  value,
  onChange,
  readOnly = false,
}: {
  value: string;
  onChange: (next: string) => void;
  readOnly?: boolean;
}) {
  const t = useT();

  return (
    <div className="space-y-1.5">
      <AiTabIndicator />
      <RichContentBlock
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        placeholder={t("meetingCanvas.clickToEdit")}
        ariaLabel={t("meetingDetail.aiNotes")}
        editorClassName="text-sm leading-relaxed text-muted-foreground"
      />
    </div>
  );
}

function RichContentBlock({
  value,
  onChange,
  readOnly,
  placeholder,
  ariaLabel,
  editorClassName,
}: {
  value: string;
  onChange: (next: string) => void;
  readOnly: boolean;
  placeholder: string;
  ariaLabel: string;
  editorClassName?: string;
}) {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (focusedRef.current) return;
    draftRef.current = value;
    setDraft(value);
  }, [value]);

  const commit = () => {
    focusedRef.current = false;
    const next = draftRef.current;
    if (next !== value) onChange(next);
  };

  return (
    <SharedRichEditor
      value={draft}
      onChange={(next) => {
        focusedRef.current = true;
        draftRef.current = next;
        setDraft(next);
      }}
      onBlur={commit}
      editable={!readOnly}
      dialect="nfm"
      preset="content"
      placeholder={placeholder}
      ariaLabel={ariaLabel}
      className="-mx-1 rounded-md px-1"
      editorClassName={cn("min-h-[2rem]", editorClassName)}
    />
  );
}


function AiBulletsBlock({
  bullets,
  renderBullet,
}: {
  bullets: string[];
  renderBullet?: (bullet: string, index: number) => React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <AiTabIndicator />
      <ul className="space-y-1.5">
        {bullets.map((b, i) => {
          const content = (
            <div className="flex gap-2 text-sm leading-relaxed text-muted-foreground">
              <span>•</span>
              <span className="flex-1">{b}</span>
            </div>
          );
          return <li key={i}>{renderBullet ? renderBullet(b, i) : content}</li>;
        })}
      </ul>
    </div>
  );
}


function AiTabIndicator() {
  return null;
}
