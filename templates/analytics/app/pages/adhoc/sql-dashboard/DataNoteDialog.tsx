import { useT } from "@agent-native/core/client/i18n";
import {
  MAX_DATA_NOTE_EVENT_LENGTH,
  MAX_DATA_NOTE_EVENTS,
  dataNoteAppliesTo,
  dataNoteEventsFit,
  type DataNote,
  type DataNoteKind,
  type DataNotePanelRef,
} from "@shared/data-notes";
import { IconX } from "@tabler/icons-react";
import { useId, useMemo, useRef, useState } from "react";

import {
  useDeleteDataNote,
  useSaveDataNote,
  type DataNoteInput,
} from "@/components/dashboard/annotation-mutations";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import type { DashboardAnnotations, SqlPanel } from "./types";

/** An existing note to edit, or the fields a new one starts with. */
export type DataNoteDraft =
  | { note: DataNote; markFixed?: boolean }
  | { note?: undefined; initial?: Partial<DataNoteInput> };

interface FormState {
  kind: DataNoteKind;
  title: string;
  note: string;
  startDate: string;
  endDate: string;
  /**
   * The end date unchecking Fixed puts back: the open note's own, or none for
   * a note saved as fixed, which reopens as ongoing.
   */
  openEndDate: string;
  fixed: boolean;
  fix: string;
  matchEvents: string;
  unlessEvents: string;
  panels: DataNotePanelRef[];
}

/** Today in the viewer's zone, "YYYY-MM-DD". */
const today = () => new Date().toLocaleDateString("en-CA");

const kindItemClass =
  "h-7 rounded px-2.5 text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground data-[state=on]:bg-accent data-[state=on]:text-foreground data-[state=on]:shadow-sm";

const splitEvents = (text: string) =>
  text
    .split(",")
    .map((event) => event.trim())
    .filter(Boolean);

const marksFixed = (draft: DataNoteDraft) =>
  draft.note ? draft.markFixed === true : false;

function initialForm(draft: DataNoteDraft): FormState {
  const source: Partial<DataNoteInput> = draft.note ?? draft.initial ?? {};
  return {
    kind: source.kind ?? "incident",
    title: source.title ?? "",
    note: source.note ?? "",
    startDate: source.startDate ?? "",
    endDate: source.endDate ?? (marksFixed(draft) ? today() : ""),
    openEndDate: source.status === "fixed" ? "" : (source.endDate ?? ""),
    fixed: marksFixed(draft) || source.status === "fixed",
    fix: source.fix ?? "",
    matchEvents: (source.matchEvents ?? []).join(", "),
    unlessEvents: (source.unlessEvents ?? []).join(", "),
    panels: source.panels ?? [],
  };
}

function OptionalDate({
  value,
  onChange,
  placeholder,
  clearLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  clearLabel: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <DatePicker
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="flex-1"
      />
      {value ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          aria-label={clearLabel}
          onClick={() => onChange("")}
        >
          <IconX className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

interface DataNoteDialogProps {
  draft: DataNoteDraft | null;
  onClose: () => void;
  dashboardId: string;
  panels: readonly SqlPanel[];
  annotations?: DashboardAnnotations;
  /** Absent when the viewer can't edit this dashboard. */
  onAnnotationsChange?: (next: DashboardAnnotations) => void;
}

export function DataNoteDialog({ draft, ...props }: DataNoteDialogProps) {
  // Mounted per open, so each open starts from its own draft.
  return draft ? <DataNoteForm draft={draft} {...props} /> : null;
}

function DataNoteForm({
  draft,
  onClose,
  dashboardId,
  panels,
  annotations,
  onAnnotationsChange,
}: DataNoteDialogProps & { draft: DataNoteDraft }) {
  const t = useT();
  const ids = useId();
  const saveNote = useSaveDataNote();
  const deleteNote = useDeleteDataNote();
  const [initial] = useState<FormState>(() => initialForm(draft));
  const [form, setForm] = useState(initial);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const fixRef = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  const update = (patch: Partial<FormState>) =>
    setForm((current) => ({ ...current, ...patch }));

  const existing = draft.note;
  const charts = useMemo(
    () => panels.filter((panel) => panel.chartType !== "section"),
    [panels],
  );
  const hiddenHere = useMemo(() => {
    if (!existing) return [];
    const hiddenIds = new Set(
      (annotations?.hiddenDataNotes ?? [])
        .filter((entry) => entry.noteId === existing.id)
        .map((entry) => entry.panelId),
    );
    return charts.filter((panel) => hiddenIds.has(panel.id));
  }, [annotations, charts, existing]);
  const matchCount = useMemo(() => {
    const candidate = {
      matchEvents: splitEvents(form.matchEvents),
      unlessEvents: splitEvents(form.unlessEvents),
      panels: form.panels,
    };
    return charts.filter(
      (panel) =>
        !hiddenHere.includes(panel) &&
        dataNoteAppliesTo(candidate, dashboardId, panel),
    ).length;
  }, [charts, dashboardId, form, hiddenHere]);

  const pinnedHere = form.panels.filter(
    (ref) => ref.dashboardId === dashboardId,
  );
  const unpinned = charts.filter(
    (panel) => !pinnedHere.some((ref) => ref.panelId === panel.id),
  );
  const matchEvents = splitEvents(form.matchEvents);
  const unlessEvents = splitEvents(form.unlessEvents);
  const matchEventsFit = dataNoteEventsFit(matchEvents);
  const unlessEventsFit = dataNoteEventsFit(unlessEvents);
  const eventsLimit = t("annotations.eventsLimit", {
    max: MAX_DATA_NOTE_EVENTS,
    length: MAX_DATA_NOTE_EVENT_LENGTH,
  });
  const canSave =
    form.title.trim() !== "" &&
    form.note.trim() !== "" &&
    (matchEvents.length > 0 || form.panels.length > 0) &&
    matchEventsFit &&
    unlessEventsFit &&
    (!form.fixed || form.endDate !== "") &&
    (!form.startDate || !form.endDate || form.startDate <= form.endDate);

  const handleSave = () => {
    if (!canSave) return;
    const input: DataNoteInput = {
      ...(existing ? { id: existing.id } : {}),
      kind: form.kind,
      title: form.title.trim(),
      note: form.note.trim(),
      startDate: form.startDate || null,
      endDate: form.endDate || null,
      status: form.fixed ? "fixed" : "open",
      fix: form.fixed && form.fix.trim() ? form.fix.trim() : null,
      matchEvents,
      unlessEvents,
      panels: form.panels,
    };
    onClose();
    saveNote.mutate(input);
  };

  const handleDelete = () => {
    if (!existing) return;
    setConfirmDelete(false);
    onClose();
    deleteNote.mutate({ id: existing.id });
  };

  const showAgain = () => {
    if (!existing || !onAnnotationsChange) return;
    const hiddenDataNotes = (annotations?.hiddenDataNotes ?? []).filter(
      (entry) => entry.noteId !== existing.id,
    );
    const { hiddenDataNotes: _previous, ...rest } = annotations ?? {};
    onAnnotationsChange(
      hiddenDataNotes.length > 0 ? { ...rest, hiddenDataNotes } : rest,
    );
  };

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          className="flex max-h-[90vh] flex-col overflow-hidden p-0 sm:max-w-[480px]"
          onOpenAutoFocus={(event) => {
            const field = marksFixed(draft)
              ? fixRef.current
              : existing
                ? null
                : titleRef.current;
            if (!field) return;
            event.preventDefault();
            field.focus();
          }}
          // Escape, Cancel and the close button still discard an edit; a
          // stray click beside the dialog must not.
          onInteractOutside={(event) => {
            if (dirty) event.preventDefault();
          }}
        >
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>
              {existing
                ? t("annotations.editDataNote")
                : t("annotations.addDataNote")}
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-1">
            <ToggleGroup
              type="single"
              value={form.kind}
              onValueChange={(value) =>
                value && update({ kind: value as DataNoteKind })
              }
              className="inline-flex gap-1 rounded-lg border border-border/60 bg-background/50 p-1"
            >
              <ToggleGroupItem value="incident" className={kindItemClass}>
                {t("dataNotes.incident")}
              </ToggleGroupItem>
              <ToggleGroupItem value="data" className={kindItemClass}>
                {t("dataNotes.dataProblem")}
              </ToggleGroupItem>
            </ToggleGroup>
            <div className="space-y-1.5">
              <Label htmlFor={`${ids}-title`}>{t("annotations.title")}</Label>
              <Input
                ref={titleRef}
                id={`${ids}-title`}
                value={form.title}
                maxLength={120}
                onChange={(event) => update({ title: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${ids}-note`}>{t("annotations.note")}</Label>
              <Textarea
                id={`${ids}-note`}
                value={form.note}
                maxLength={1000}
                rows={3}
                onChange={(event) => update({ note: event.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("annotations.start")}</Label>
                <OptionalDate
                  value={form.startDate}
                  onChange={(startDate) => update({ startDate })}
                  placeholder={t("annotations.noStart")}
                  clearLabel={t("annotations.clearDate")}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("annotations.end")}</Label>
                <OptionalDate
                  value={form.endDate}
                  onChange={(endDate) =>
                    update(
                      form.fixed
                        ? { endDate }
                        : { endDate, openEndDate: endDate },
                    )
                  }
                  placeholder={t("annotations.ongoing")}
                  clearLabel={t("annotations.clearDate")}
                />
              </div>
            </div>
            <label
              htmlFor={`${ids}-fixed`}
              className="flex cursor-pointer items-center gap-2 text-sm"
            >
              <Checkbox
                id={`${ids}-fixed`}
                checked={form.fixed}
                onCheckedChange={(checked) =>
                  update(
                    checked === true
                      ? { fixed: true, endDate: form.endDate || today() }
                      : { fixed: false, endDate: form.openEndDate },
                  )
                }
              />
              <span>{t("dataNotes.fixed")}</span>
            </label>
            {form.fixed ? (
              <Input
                ref={fixRef}
                aria-label={t("annotations.fixedBy")}
                placeholder={t("annotations.fixedBy")}
                value={form.fix}
                maxLength={500}
                onChange={(event) => update({ fix: event.target.value })}
              />
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor={`${ids}-events`}>{t("annotations.events")}</Label>
              <Input
                id={`${ids}-events`}
                value={form.matchEvents}
                placeholder={t("annotations.eventsPlaceholder")}
                aria-invalid={!matchEventsFit || undefined}
                aria-describedby={
                  matchEventsFit ? undefined : `${ids}-events-limit`
                }
                onChange={(event) =>
                  update({ matchEvents: event.target.value })
                }
              />
              {matchEventsFit ? null : (
                <p
                  id={`${ids}-events-limit`}
                  className="text-xs text-destructive"
                >
                  {eventsLimit}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${ids}-unless`}>
                {t("annotations.unlessEvents")}
              </Label>
              <Input
                id={`${ids}-unless`}
                value={form.unlessEvents}
                aria-invalid={!unlessEventsFit || undefined}
                aria-describedby={
                  unlessEventsFit ? undefined : `${ids}-unless-limit`
                }
                onChange={(event) =>
                  update({ unlessEvents: event.target.value })
                }
              />
              {unlessEventsFit ? null : (
                <p
                  id={`${ids}-unless-limit`}
                  className="text-xs text-destructive"
                >
                  {eventsLimit}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>{t("annotations.charts")}</Label>
              <div className="flex flex-wrap items-center gap-1.5">
                {pinnedHere.map((ref) => {
                  const panel = charts.find((p) => p.id === ref.panelId);
                  const title = panel?.title ?? ref.panelId;
                  return (
                    <Badge
                      key={ref.panelId}
                      variant="secondary"
                      className="gap-1 pr-1"
                    >
                      <span className="max-w-[180px] truncate">{title}</span>
                      <button
                        type="button"
                        className="rounded-sm opacity-60 hover:opacity-100"
                        aria-label={t("annotations.unpin", { title })}
                        onClick={() =>
                          update({
                            panels: form.panels.filter(
                              (other) => other !== ref,
                            ),
                          })
                        }
                      >
                        <IconX className="size-3" />
                      </button>
                    </Badge>
                  );
                })}
                {unpinned.length > 0 ? (
                  <Select
                    value=""
                    onValueChange={(panelId) =>
                      update({
                        panels: [...form.panels, { dashboardId, panelId }],
                      })
                    }
                  >
                    <SelectTrigger className="h-7 w-auto gap-1 text-xs">
                      <SelectValue placeholder={t("annotations.pinChart")} />
                    </SelectTrigger>
                    <SelectContent>
                      {unpinned.map((panel) => (
                        <SelectItem key={panel.id} value={panel.id}>
                          {panel.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("annotations.chartsHere", {
                  count: matchCount,
                  total: charts.length,
                })}
              </p>
            </div>
            {hiddenHere.length > 0 ? (
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="min-w-0 truncate">
                  {t("annotations.hiddenOn", {
                    charts: hiddenHere.map((panel) => panel.title).join(", "),
                  })}
                </span>
                {onAnnotationsChange ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 shrink-0 px-2 text-xs"
                    onClick={showAgain}
                  >
                    {t("annotations.showAgain")}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
          <DialogFooter className="gap-2 border-t border-border/60 px-6 py-4 sm:justify-between">
            {existing ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                {t("sidebar.delete")}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onClose}>
                {t("sidebar.cancel")}
              </Button>
              <Button size="sm" onClick={handleSave} disabled={!canSave}>
                {t("sqlDashboard.save")}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("annotations.deleteDataNoteTitle", {
                title: existing?.title ?? "",
              })}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("sidebar.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              {t("sidebar.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
