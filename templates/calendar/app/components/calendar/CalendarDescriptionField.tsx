import { useT } from "@agent-native/core/client/i18n";
import { isComposingKey } from "@agent-native/toolkit/app/review";
import {
  MAX_CALENDAR_DESCRIPTION_LENGTH,
  normalizeCalendarDescription,
} from "@shared/calendar-descriptions";
import { useEffect, useId, useState } from "react";

import { Textarea } from "@/components/ui/textarea";

export function CalendarDescriptionField({
  value,
  onSave,
}: {
  value: string | undefined;
  onSave: (description: string) => void;
}) {
  const t = useT();
  const id = useId();
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  function commit() {
    const next = normalizeCalendarDescription(draft);
    if (next === normalizeCalendarDescription(value)) return;
    onSave(next ?? "");
  }

  return (
    <div className="mt-2 w-56 border-t border-border pt-2">
      <label htmlFor={id} className="mb-1 block text-xs font-medium">
        {t("sidebar.calendarDescription")}
      </label>
      <Textarea
        id={id}
        value={draft}
        rows={3}
        maxLength={MAX_CALENDAR_DESCRIPTION_LENGTH}
        placeholder={t("sidebar.calendarDescriptionPlaceholder")}
        className="min-h-0 resize-none text-xs"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || isComposingKey(event)) return;
          event.preventDefault();
          event.currentTarget.blur();
        }}
      />
      <p className="mt-1 text-[11px] text-muted-foreground">
        {t("sidebar.calendarDescriptionHint")}
      </p>
    </div>
  );
}

export function keepEscapeWhileComposing(event: KeyboardEvent) {
  if (isComposingKey(event)) event.preventDefault();
}
