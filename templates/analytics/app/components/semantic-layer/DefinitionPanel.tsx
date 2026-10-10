import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { actionErrorMessage } from "@agent-native/core/client/use-action";
import {
  IconChevronDown,
  IconChevronRight,
  IconExternalLink,
  IconLoader2,
  IconTrash,
} from "@tabler/icons-react";
import {
  useEffect,
  useId,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import type { DictionaryEntry, DictionaryPage } from "./types";

const KNOWN_SOURCES = [
  "first-party",
  "bigquery",
  "hubspot",
  "dbt",
  "sigma",
  "amplitude",
  "stripe",
  "github",
  "sentry",
];

interface DefinitionDraft {
  metric: string;
  definition: string;
  source: string;
  department: string;
  owner: string;
  approved: boolean;
  aiGenerated: boolean;
  sourceUrl: string;
  table: string;
  columnsUsed: string;
  cuts: string;
  queryTemplate: string;
  updateFrequency: string;
  dataLag: string;
  knownGotchas: string;
  commonQuestions: string;
  exampleUseCase: string;
}

const OPTIONAL_TEXT_KEYS = [
  "table",
  "columnsUsed",
  "cuts",
  "queryTemplate",
  "updateFrequency",
  "dataLag",
  "knownGotchas",
  "commonQuestions",
  "exampleUseCase",
] as const;

function draftFrom(entry: DictionaryEntry | null): DefinitionDraft {
  return {
    metric: entry?.metric ?? "",
    definition: entry?.definition ?? "",
    source: entry?.source ?? "",
    department: entry?.department ?? "",
    owner: entry?.owner ?? "",
    approved: entry?.approved === true,
    aiGenerated: entry?.aiGenerated === true,
    sourceUrl: entry?.sourceUrl ?? "",
    table: entry?.table ?? "",
    columnsUsed: entry?.columnsUsed ?? "",
    cuts: entry?.cuts ?? "",
    queryTemplate: entry?.queryTemplate ?? "",
    updateFrequency: entry?.updateFrequency ?? "",
    dataLag: entry?.dataLag ?? "",
    knownGotchas: entry?.knownGotchas ?? "",
    commonQuestions: entry?.commonQuestions ?? "",
    exampleUseCase: entry?.exampleUseCase ?? "",
  };
}

function hasOptionalValues(draft: DefinitionDraft): boolean {
  return OPTIONAL_TEXT_KEYS.some((key) => draft[key] !== "");
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function DefinitionPanel({
  entry,
  onDone,
  readOnly,
}: {
  entry: DictionaryEntry | null;
  onDone: () => void;
  readOnly: boolean;
}) {
  const t = useT();
  const ids = useId();
  const save = useActionMutation("save-data-dictionary-entry");
  const remove = useActionMutation("delete-data-dictionary-entry");

  const entryKey = entry?.id ?? "__new__";
  const [shownKey, setShownKey] = useState(entryKey);
  const [draft, setDraft] = useState(() => draftFrom(entry));
  const [moreOpen, setMoreOpen] = useState(() => hasOptionalValues(draft));
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  if (entryKey !== shownKey) {
    const next = draftFrom(entry);
    setShownKey(entryKey);
    setDraft(next);
    setMoreOpen(hasOptionalValues(next));
    setError("");
  }

  const set = <K extends keyof DefinitionDraft>(
    key: K,
    value: DefinitionDraft[K],
  ) => setDraft((d) => ({ ...d, [key]: value }));

  const metric = draft.metric.trim();
  const metricKey = metric.toLowerCase();
  const debouncedMetric = useDebouncedValue(metric, 250);
  const sameName = useActionQuery(
    "list-data-dictionary",
    { search: debouncedMetric, limit: 5 },
    { enabled: !entry && debouncedMetric !== "" },
  );
  const sameNamePage = sameName.data as DictionaryPage | undefined;
  // Source-index suggestions save under a different id (`index-*`), so saving
  // over one would create a sibling rather than update it. Only stored entries count.
  const sameNameEntry =
    !entry && metricKey !== ""
      ? sameNamePage?.results.find(
          (candidate) =>
            candidate.sourceIndex !== true &&
            candidate.metric.trim().toLowerCase() === metricKey,
        )
      : undefined;
  const sameNameCheckFailed = !entry && sameName.isError;

  const sourceUrl = draft.sourceUrl.trim();
  const sourceUrlInvalid = sourceUrl !== "" && !isHttpUrl(sourceUrl);
  const showSourceLink = sourceUrl !== "" && !sourceUrlInvalid;
  const canSave =
    !save.isPending &&
    !!metric &&
    !!draft.definition.trim() &&
    !sourceUrlInvalid;
  const canDelete = !!entry?.id && !entry.sourceIndex;

  // Blank optional fields on create are sent as undefined, which the action
  // reads as "keep existing". Sending "" would blank a same-name entry's values.
  const optional = (value: string) => (entry || value ? value : undefined);

  const submit = async () => {
    if (readOnly || !canSave) return;
    setError("");
    try {
      await save.mutateAsync({
        ...(entry?.id
          ? { id: entry.id }
          : sameNameEntry
            ? { id: sameNameEntry.id }
            : {}),
        metric,
        definition: draft.definition.trim(),
        source: optional(draft.source.trim()),
        department: optional(draft.department.trim()),
        owner: optional(draft.owner.trim()),
        sourceUrl: optional(sourceUrl),
        table: optional(draft.table.trim()),
        columnsUsed: optional(draft.columnsUsed.trim()),
        cuts: optional(draft.cuts.trim()),
        queryTemplate: optional(draft.queryTemplate.trim()),
        updateFrequency: optional(draft.updateFrequency.trim()),
        dataLag: optional(draft.dataLag.trim()),
        knownGotchas: optional(draft.knownGotchas.trim()),
        commonQuestions: optional(draft.commonQuestions.trim()),
        exampleUseCase: optional(draft.exampleUseCase.trim()),
        status: entry?.status,
        // Omit trust flags on a same-name save: draft values would overwrite the stored entry's approval.
        ...(sameNameEntry
          ? {}
          : { approved: draft.approved, aiGenerated: draft.aiGenerated }),
      });
    } catch (err) {
      setError(actionErrorMessage(err) ?? t("dataDictionary.saveFailed"));
      return;
    }
    onDone();
  };

  const confirmRemove = async (event: MouseEvent<HTMLButtonElement>) => {
    const id = entry?.id;
    if (!id) return;
    // Keep the dialog open until the delete settles so a failure stays visible.
    event.preventDefault();
    setDeleteError("");
    try {
      await remove.mutateAsync({ id });
    } catch (err) {
      setDeleteError(
        actionErrorMessage(err) ?? t("dataDictionary.deleteFailed"),
      );
      return;
    }
    setConfirmDelete(false);
    onDone();
  };

  const sourceListId = `${ids}-sources`;

  return (
    <>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {/* Disabling the fieldset locks every control inside it. The optional-fields
            trigger stays outside so non-admins can still read those fields. */}
        <fieldset disabled={readOnly} className="space-y-4">
          <Field
            id={`${ids}-metric`}
            label={t("dataDictionary.metric")}
            required
          >
            <Input
              id={`${ids}-metric`}
              value={draft.metric}
              onChange={(e) => set("metric", e.target.value)}
              placeholder={t("dataDictionary.metricPlaceholder")}
            />
            {sameNameEntry ? (
              <p className="text-xs text-muted-foreground">
                {t("dataDictionary.sameNameNote")}
              </p>
            ) : sameNameCheckFailed ? (
              <p className="text-xs text-muted-foreground">
                {t("dataDictionary.sameNameCheckFailed")}
              </p>
            ) : null}
          </Field>

          <Field
            id={`${ids}-definition`}
            label={t("dataDictionary.definition")}
            required
          >
            <Textarea
              id={`${ids}-definition`}
              value={draft.definition}
              onChange={(e) => set("definition", e.target.value)}
              rows={3}
              placeholder={t("dataDictionary.definitionPlaceholder")}
            />
          </Field>

          <Field id={`${ids}-source`} label={t("dataDictionary.sourceLabel")}>
            <Input
              id={`${ids}-source`}
              list={sourceListId}
              value={draft.source}
              onChange={(e) => set("source", e.target.value)}
            />
            <datalist id={sourceListId}>
              {KNOWN_SOURCES.map((source) => (
                <option key={source} value={source} />
              ))}
            </datalist>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field
              id={`${ids}-department`}
              label={t("dataDictionary.department")}
            >
              <Input
                id={`${ids}-department`}
                value={draft.department}
                onChange={(e) => set("department", e.target.value)}
                placeholder={t("dataDictionary.departmentPlaceholder")}
              />
            </Field>
            <Field id={`${ids}-owner`} label={t("dataDictionary.owner")}>
              <Input
                id={`${ids}-owner`}
                value={draft.owner}
                onChange={(e) => set("owner", e.target.value)}
                placeholder={t("dataDictionary.ownerPlaceholder")}
              />
            </Field>
          </div>

          <div className="grid gap-3 rounded-md bg-muted/30 p-3">
            <SwitchRow
              id={`${ids}-approved`}
              title={t("dataDictionary.approvedTitle")}
              description={t("dataDictionary.approvedDescription")}
              checked={
                sameNameEntry ? sameNameEntry.approved === true : draft.approved
              }
              disabled={!!sameNameEntry}
              onCheckedChange={(checked) => set("approved", checked)}
            />
            <SwitchRow
              id={`${ids}-ai-generated`}
              title={t("dataDictionary.aiGeneratedTitle")}
              description={t("dataDictionary.aiGeneratedDescription")}
              checked={
                sameNameEntry
                  ? sameNameEntry.aiGenerated === true
                  : draft.aiGenerated
              }
              disabled={!!sameNameEntry}
              onCheckedChange={(checked) => set("aiGenerated", checked)}
            />
          </div>

          <Field
            id={`${ids}-source-url`}
            label={t("dataDictionary.sourceUrlLabel")}
          >
            <Input
              id={`${ids}-source-url`}
              type="url"
              inputMode="url"
              value={draft.sourceUrl}
              aria-invalid={sourceUrlInvalid || undefined}
              onChange={(e) => set("sourceUrl", e.target.value)}
            />
            {sourceUrlInvalid ? (
              <p className="text-xs text-destructive">
                {t("dataDictionary.sourceUrlInvalid")}
              </p>
            ) : null}
            {showSourceLink ? (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-fit items-center gap-1 text-xs text-primary hover:underline"
              >
                <IconExternalLink className="h-3 w-3" />
                {t("dataDictionary.openSource")}
              </a>
            ) : null}
          </Field>
        </fieldset>

        <Collapsible open={moreOpen} onOpenChange={setMoreOpen}>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm">
              {moreOpen ? (
                <IconChevronDown className="h-3 w-3" />
              ) : (
                <IconChevronRight className="h-3 w-3" />
              )}
              {t("dataDictionary.moreFields")}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-4">
            <fieldset disabled={readOnly} className="grid gap-4">
              <Field
                id={`${ids}-table`}
                label={t("dataDictionary.sourceTables")}
              >
                <Input
                  id={`${ids}-table`}
                  value={draft.table}
                  onChange={(e) => set("table", e.target.value)}
                  placeholder={t("dataDictionary.sourceTablesPlaceholder")}
                />
              </Field>

              <Field
                id={`${ids}-columns`}
                label={t("dataDictionary.columnsUsed")}
              >
                <Input
                  id={`${ids}-columns`}
                  value={draft.columnsUsed}
                  onChange={(e) => set("columnsUsed", e.target.value)}
                  placeholder={t("dataDictionary.columnsUsedPlaceholder")}
                />
              </Field>

              <Field
                id={`${ids}-cuts`}
                label={t("dataDictionary.standardCuts")}
              >
                <Input
                  id={`${ids}-cuts`}
                  value={draft.cuts}
                  onChange={(e) => set("cuts", e.target.value)}
                  placeholder={t("dataDictionary.standardCutsPlaceholder")}
                />
              </Field>

              <Field
                id={`${ids}-query`}
                label={t("dataDictionary.queryTemplate")}
              >
                <Textarea
                  id={`${ids}-query`}
                  value={draft.queryTemplate}
                  onChange={(e) => set("queryTemplate", e.target.value)}
                  rows={5}
                  className="font-mono text-xs"
                  placeholder={t("dataDictionary.queryTemplatePlaceholder")}
                />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field
                  id={`${ids}-update-frequency`}
                  label={t("dataDictionary.updateFrequency")}
                >
                  <Input
                    id={`${ids}-update-frequency`}
                    value={draft.updateFrequency}
                    onChange={(e) => set("updateFrequency", e.target.value)}
                    placeholder={t("dataDictionary.updateFrequencyPlaceholder")}
                  />
                </Field>
                <Field
                  id={`${ids}-data-lag`}
                  label={t("dataDictionary.dataLag")}
                >
                  <Input
                    id={`${ids}-data-lag`}
                    value={draft.dataLag}
                    onChange={(e) => set("dataLag", e.target.value)}
                    placeholder={t("dataDictionary.dataLagPlaceholder")}
                  />
                </Field>
              </div>

              <Field
                id={`${ids}-gotchas`}
                label={t("dataDictionary.knownGotchas")}
              >
                <Textarea
                  id={`${ids}-gotchas`}
                  value={draft.knownGotchas}
                  onChange={(e) => set("knownGotchas", e.target.value)}
                  rows={2}
                  placeholder={t("dataDictionary.knownGotchasPlaceholder")}
                />
              </Field>

              <Field
                id={`${ids}-common-questions`}
                label={t("dataDictionary.commonQuestions")}
              >
                <Textarea
                  id={`${ids}-common-questions`}
                  value={draft.commonQuestions}
                  onChange={(e) => set("commonQuestions", e.target.value)}
                  rows={2}
                  placeholder={t("dataDictionary.commonQuestionsPlaceholder")}
                />
              </Field>

              <Field
                id={`${ids}-example-use-case`}
                label={t("dataDictionary.exampleUseCase")}
              >
                <Textarea
                  id={`${ids}-example-use-case`}
                  value={draft.exampleUseCase}
                  onChange={(e) => set("exampleUseCase", e.target.value)}
                  rows={2}
                  placeholder={t("dataDictionary.exampleUseCasePlaceholder")}
                />
              </Field>
            </fieldset>
          </CollapsibleContent>
        </Collapsible>

        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}

        {readOnly ? (
          <p className="pt-1 text-sm text-muted-foreground">
            {t("semanticLayer.adminOnlyNote")}
          </p>
        ) : (
          <div className="flex items-center justify-between gap-2 pt-1">
            {canDelete ? (
              <Button
                type="button"
                size="sm"
                variant="outline-destructive"
                disabled={save.isPending}
                onClick={() => {
                  setDeleteError("");
                  setConfirmDelete(true);
                }}
              >
                <IconTrash className="me-1.5 h-3 w-3" />
                {t("sidebar.delete")}
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" size="sm" disabled={!canSave}>
              {save.isPending ? (
                <>
                  <IconLoader2 className="me-1.5 h-3 w-3 animate-spin" />
                  {t("dataDictionary.saving")}
                </>
              ) : (
                t("dataDictionary.saveEntry")
              )}
            </Button>
          </div>
        )}
      </form>

      <AlertDialog
        open={confirmDelete}
        onOpenChange={(open) => {
          if (!remove.isPending) setConfirmDelete(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("dataDictionary.deleteTitle", {
                metric: entry?.metric ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("dataDictionary.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? (
            <p role="alert" className="text-xs text-destructive">
              {deleteError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              {t("sidebar.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={confirmRemove}
              disabled={remove.isPending}
            >
              {remove.isPending
                ? t("dataDictionary.deleting")
                : t("sidebar.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function SwitchRow({
  id,
  title,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string;
  title: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const label = (
    <label htmlFor={id} className="min-w-0 text-sm">
      {title}
    </label>
  );
  return (
    <div className="flex items-center justify-between gap-3">
      {description ? (
        <Tooltip>
          <TooltipTrigger asChild>{label}</TooltipTrigger>
          <TooltipContent>{description}</TooltipContent>
        </Tooltip>
      ) : (
        label
      )}
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

function Field({
  id,
  label,
  required,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="ms-0.5 text-destructive">*</span>}
      </label>
      {children}
    </div>
  );
}
