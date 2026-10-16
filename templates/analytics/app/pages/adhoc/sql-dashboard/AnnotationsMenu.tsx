import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  dataNoteAppliesTo,
  panelDrawsDataNotes,
  type DataNote,
} from "@shared/data-notes";
import {
  IconChevronDown,
  IconFlag,
  IconPencil,
  IconPlus,
} from "@tabler/icons-react";
import { useMemo, useRef, useState } from "react";

import { isPendingAnnotation } from "@/components/dashboard/annotation-mutations";
import { dataNoteColor } from "@/components/dashboard/data-note-bands";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import type { DashboardAnnotations, SqlPanel } from "./types";

export function AnnotationsMenu({
  dashboardId,
  panels,
  annotations,
  editing,
  onAnnotationsChange,
  onAddKeyDate,
  onEditKeyDates,
  onAddDataNote,
  onEditDataNote,
}: {
  dashboardId: string;
  panels: readonly SqlPanel[];
  annotations?: DashboardAnnotations;
  /** Every change here shows for everyone, so outside Edit mode the menu only lists. */
  editing: boolean;
  /** Absent outside Edit mode. */
  onAnnotationsChange?: (next: DashboardAnnotations) => void;
  onAddKeyDate: () => void;
  onEditKeyDates: () => void;
  onAddDataNote: () => void;
  onEditDataNote: (note: DataNote) => void;
}) {
  const t = useT();
  // The dashboard's own lists, as its charts draw them.
  const { data: keyDateData } = useActionQuery(
    "list-key-dates",
    { dashboardId },
    { staleTime: 60_000 },
  );
  const { data: dataNoteData } = useActionQuery(
    "list-data-notes",
    { dashboardId },
    { staleTime: 60_000 },
  );
  // Writes wait for the lists: a shared dashboard's annotations are its
  // organization's, and a write before that's known would land in the viewer's.
  const keyDatesEditable = editing && keyDateData?.editable === true;
  const notesEditable = editing && dataNoteData?.editable === true;
  const returningFocus = useRef(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const sets = keyDateData?.sets ?? [];
  const hiddenSets = new Set(annotations?.hiddenKeyDateSets);
  const hiddenNotes = new Set(
    annotations?.hiddenDataNotes?.map((entry) => entry.noteId),
  );
  const notesHere = useMemo(
    () =>
      (dataNoteData?.notes ?? []).filter((note) =>
        panels.some(
          (panel) =>
            panelDrawsDataNotes(panel) &&
            dataNoteAppliesTo(note, dashboardId, panel),
        ),
      ),
    [dashboardId, dataNoteData, panels],
  );

  const toggleSet = (setId: string, shown: boolean) => {
    if (!onAnnotationsChange) return;
    const hiddenKeyDateSets = shown
      ? [...hiddenSets].filter((id) => id !== setId)
      : [...hiddenSets, setId];
    const { hiddenKeyDateSets: _previous, ...rest } = annotations ?? {};
    onAnnotationsChange(
      hiddenKeyDateSets.length > 0 ? { ...rest, hiddenKeyDateSets } : rest,
    );
  };

  const showNoteAgain = (noteId: string) => {
    if (!onAnnotationsChange) return;
    const hiddenDataNotes = (annotations?.hiddenDataNotes ?? []).filter(
      (entry) => entry.noteId !== noteId,
    );
    const { hiddenDataNotes: _previous, ...rest } = annotations ?? {};
    onAnnotationsChange(
      hiddenDataNotes.length > 0 ? { ...rest, hiddenDataNotes } : rest,
    );
  };

  return (
    <DropdownMenu>
      <Tooltip
        open={tooltipOpen}
        onOpenChange={(open) => setTooltipOpen(open && !returningFocus.current)}
      >
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs">
              <IconFlag className="h-3.5 w-3.5" />
              <span>{t("annotations.menu")}</span>
              <IconChevronDown className="h-3 w-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("annotations.menuTooltip")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        className="w-64"
        // Radix moves focus back to the trigger right after this. That focus
        // is the menu closing, not a visit that should show its tooltip.
        onCloseAutoFocus={() => {
          returningFocus.current = true;
          queueMicrotask(() => {
            returningFocus.current = false;
          });
        }}
      >
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {t("annotations.keyDates")}
        </DropdownMenuLabel>
        {sets.map((set) => (
          <DropdownMenuCheckboxItem
            key={set.id}
            checked={!hiddenSets.has(set.id)}
            disabled={!onAnnotationsChange || isPendingAnnotation(set.id)}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) => toggleSet(set.id, checked === true)}
          >
            <span className="min-w-0 flex-1 truncate">{set.name}</span>
            <span className="ml-2 shrink-0 tabular-nums text-xs text-muted-foreground">
              {set.dates.length}
            </span>
          </DropdownMenuCheckboxItem>
        ))}
        {keyDatesEditable ? (
          <DropdownMenuItem onSelect={onAddKeyDate}>
            <IconPlus className="mr-2 h-4 w-4" />
            {t("annotations.addKeyDate")}
          </DropdownMenuItem>
        ) : null}
        {keyDatesEditable && sets.length > 0 ? (
          <DropdownMenuItem onSelect={onEditKeyDates}>
            <IconPencil className="mr-2 h-4 w-4" />
            {t("annotations.editKeyDates")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {t("annotations.dataNotes")}
        </DropdownMenuLabel>
        {notesHere.map((note) => {
          // The note dialog, which has the other "Show again", won't open on
          // another organization's note, yet its dashboard's editor can hide it.
          const showAgain =
            !notesEditable && !!onAnnotationsChange && hiddenNotes.has(note.id);
          return (
            <DropdownMenuItem
              key={note.id}
              disabled={
                (!notesEditable && !showAgain) || isPendingAnnotation(note.id)
              }
              onSelect={() =>
                showAgain ? showNoteAgain(note.id) : onEditDataNote(note)
              }
            >
              <span
                className="mr-2 size-2 shrink-0 rounded-full"
                style={{ background: dataNoteColor(note) }}
              />
              <span className="min-w-0 truncate">{note.title}</span>
              {showAgain ? (
                <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">
                  {t("annotations.showAgain")}
                </span>
              ) : null}
            </DropdownMenuItem>
          );
        })}
        {notesEditable ? (
          <DropdownMenuItem onSelect={onAddDataNote}>
            <IconPlus className="mr-2 h-4 w-4" />
            {t("annotations.addDataNote")}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
