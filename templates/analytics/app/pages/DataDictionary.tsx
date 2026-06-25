import {
  useActionQuery,
  useActionMutation,
  useSendToAgentChat,
  useT,
} from "@agent-native/core/client";
import {
  IconBook2,
  IconPencil,
  IconPlus,
  IconTrash,
  IconSearch,
  IconExternalLink,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";

import { useSetHeaderActions } from "@/components/layout/HeaderActions";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface DictionaryEntry {
  id: string;
  metric: string;
  definition: string;
  department?: string;
  table?: string;
  columnsUsed?: string;
  cuts?: string;
  queryTemplate?: string;
  exampleOutput?: string;
  joinPattern?: string;
  updateFrequency?: string;
  dataLag?: string;
  dependencies?: string;
  validDateRange?: string;
  commonQuestions?: string;
  knownGotchas?: string;
  exampleUseCase?: string;
  owner?: string;
  approved?: boolean;
  aiGenerated?: boolean;
  sourceUrl?: string;
  updatedAt?: string;
}

function safeHttpUrl(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

const EMPTY_ENTRY: Partial<DictionaryEntry> = {
  metric: "",
  definition: "",
  department: "",
  table: "",
  columnsUsed: "",
  cuts: "",
  queryTemplate: "",
  exampleOutput: "",
  joinPattern: "",
  updateFrequency: "",
  dataLag: "",
  dependencies: "",
  validDateRange: "",
  commonQuestions: "",
  knownGotchas: "",
  exampleUseCase: "",
  owner: "",
  approved: true,
  aiGenerated: false,
};

const DEPARTMENT_BADGE: Record<string, string> = {
  Sales: "bg-green-500/10 text-green-600 dark:text-green-400",
  Marketing: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  Product: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  Data: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  Finance: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  Engineering: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
};

const ENTRY_BADGE_CLASS =
  "max-w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[10px] px-1.5 py-0";

function deptClass(dept?: string): string {
  if (!dept) return "bg-muted text-muted-foreground";
  return DEPARTMENT_BADGE[dept] ?? "bg-muted text-muted-foreground";
}

function DictionaryBadge({
  children,
  tooltip,
  className,
}: {
  children: React.ReactNode;
  tooltip: string;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={`${ENTRY_BADGE_CLASS} ${className ?? ""}`}
        >
          <span className="min-w-0 truncate">{children}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export default function DataDictionary() {
  const t = useT();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Partial<DictionaryEntry> | null>(null);
  const [toDelete, setToDelete] = useState<DictionaryEntry | null>(null);

  const { data: entries, isLoading } = useActionQuery(
    "list-data-dictionary",
    search ? { search } : undefined,
    { staleTime: 30_000 },
  );

  const { send } = useSendToAgentChat();

  const save = useActionMutation("save-data-dictionary-entry");
  const remove = useActionMutation("delete-data-dictionary-entry");

  const list = useMemo(
    () => (entries as DictionaryEntry[] | undefined) ?? [],
    [entries],
  );

  useSetHeaderActions(
    <Button size="sm" onClick={() => setEditing({ ...EMPTY_ENTRY })}>
      <IconPlus className="h-4 w-4 mr-1" />
      {t("dataDictionary.newDictionaryEntry")}
    </Button>,
  );

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground max-w-2xl">
        {t("dataDictionary.intro")}
      </p>

      <div className="relative max-w-md">
        <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("dataDictionary.searchPlaceholder")}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 mb-4">
              <IconBook2 className="h-7 w-7 text-primary" />
            </div>
            <h3 className="text-lg font-semibold mb-2">
              {t("dataDictionary.noEntriesTitle")}
            </h3>
            <p className="text-sm text-muted-foreground max-w-md mb-4">
              {t("dataDictionary.noEntriesDescription")}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setEditing({ ...EMPTY_ENTRY })}
              >
                <IconPlus className="h-4 w-4 mr-1" />
                {t("dataDictionary.addEntry")}
              </Button>
              <Button
                variant="ghost"
                onClick={() =>
                  send({
                    message: t("dataDictionary.populateAgentPrompt"),
                    submit: false,
                  })
                }
              >
                {t("dataDictionary.askAgent")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map((e) => (
            <Card
              key={e.id}
              className="group hover:border-primary/40 transition-colors"
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base leading-snug flex-1">
                    {e.metric}
                  </CardTitle>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setEditing(e)}
                    >
                      <IconPencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => setToDelete(e)}
                    >
                      <IconTrash className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {e.definition && (
                  <CardDescription className="line-clamp-3 text-xs">
                    {e.definition}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {e.department && (
                    <DictionaryBadge
                      tooltip={e.department}
                      className={`${deptClass(e.department)} border-0`}
                    >
                      {e.department}
                    </DictionaryBadge>
                  )}
                  {e.table && (
                    <DictionaryBadge tooltip={e.table} className="font-mono">
                      {e.table}
                    </DictionaryBadge>
                  )}
                  {e.approved ? (
                    <Badge
                      variant="outline"
                      className={`${ENTRY_BADGE_CLASS} bg-green-500/10 text-green-600 dark:text-green-400 border-0`}
                    >
                      {t("dataDictionary.approved")}
                    </Badge>
                  ) : e.aiGenerated ? (
                    <Badge
                      variant="outline"
                      className={`${ENTRY_BADGE_CLASS} bg-amber-500/10 text-amber-600 dark:text-amber-400 border-0`}
                    >
                      {t("dataDictionary.suggestion")}
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className={`${ENTRY_BADGE_CLASS} bg-muted text-muted-foreground border-0`}
                    >
                      {t("dataDictionary.unreviewed")}
                    </Badge>
                  )}
                  {e.aiGenerated && e.approved && (
                    <Badge
                      variant="outline"
                      className={`${ENTRY_BADGE_CLASS} bg-sky-500/10 text-sky-600 dark:text-sky-400 border-0`}
                    >
                      {t("dataDictionary.ai")}
                    </Badge>
                  )}
                </div>
                {safeHttpUrl(e.sourceUrl) && (
                  <a
                    href={safeHttpUrl(e.sourceUrl) ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary"
                  >
                    <IconExternalLink className="h-3 w-3" />
                    {t("dataDictionary.source")}
                  </a>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <EditEntryDialog
        entry={editing}
        onClose={() => setEditing(null)}
        onSave={async (entry) => {
          const metric = entry.metric?.trim();
          const definition = entry.definition?.trim();
          if (!metric || !definition) return;
          await save.mutateAsync({ ...entry, metric, definition });
          setEditing(null);
        }}
        saving={save.isPending}
      />

      <AlertDialog
        open={!!toDelete}
        onOpenChange={(open) => !open && setToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("dataDictionary.deleteTitle", {
                metric: toDelete?.metric ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("dataDictionary.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("sidebar.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (toDelete) {
                  await remove.mutateAsync({ id: toDelete.id });
                  setToDelete(null);
                }
              }}
            >
              {t("sidebar.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface EditEntryDialogProps {
  entry: Partial<DictionaryEntry> | null;
  onClose: () => void;
  onSave: (entry: Partial<DictionaryEntry>) => Promise<void>;
  saving: boolean;
}

function EditEntryDialog({
  entry,
  onClose,
  onSave,
  saving,
}: EditEntryDialogProps) {
  const t = useT();
  const [draft, setDraft] = useState<Partial<DictionaryEntry>>({});

  // Reset the form when a new entry is opened
  const currentId = entry?.id ?? "__new__";
  const [lastId, setLastId] = useState<string>("");
  if (entry && currentId !== lastId) {
    setDraft({ ...entry });
    setLastId(currentId);
  }
  if (!entry && lastId) setLastId("");

  const set = <K extends keyof DictionaryEntry>(
    key: K,
    value: DictionaryEntry[K],
  ) => setDraft((d) => ({ ...d, [key]: value }));

  return (
    <Dialog open={!!entry} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {entry?.id
              ? t("dataDictionary.editEntry")
              : t("dataDictionary.newDictionaryEntry")}
          </DialogTitle>
          <DialogDescription>
            {t("dataDictionary.dialogDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <Field label={t("dataDictionary.metric")} required>
            <Input
              value={draft.metric ?? ""}
              onChange={(e) => set("metric", e.target.value)}
              placeholder={t("dataDictionary.metricPlaceholder")}
            />
          </Field>
          <Field label={t("dataDictionary.definition")} required>
            <Textarea
              value={draft.definition ?? ""}
              onChange={(e) => set("definition", e.target.value)}
              rows={3}
              placeholder={t("dataDictionary.definitionPlaceholder")}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label={t("dataDictionary.department")}>
              <Input
                value={draft.department ?? ""}
                onChange={(e) => set("department", e.target.value)}
                placeholder={t("dataDictionary.departmentPlaceholder")}
              />
            </Field>
            <Field label={t("dataDictionary.owner")}>
              <Input
                value={draft.owner ?? ""}
                onChange={(e) => set("owner", e.target.value)}
                placeholder={t("dataDictionary.ownerPlaceholder")}
              />
            </Field>
          </div>

          <div className="grid gap-3 rounded-md border border-border p-3">
            <label className="flex items-start gap-3 text-sm">
              <Checkbox
                checked={!!draft.approved}
                onCheckedChange={(checked) => set("approved", checked === true)}
                className="mt-0.5"
              />
              <span>
                <span className="block font-medium">
                  {t("dataDictionary.approvedTitle")}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t("dataDictionary.approvedDescription")}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 text-sm">
              <Checkbox
                checked={!!draft.aiGenerated}
                onCheckedChange={(checked) =>
                  set("aiGenerated", checked === true)
                }
                className="mt-0.5"
              />
              <span>
                <span className="block font-medium">
                  {t("dataDictionary.aiGeneratedTitle")}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t("dataDictionary.aiGeneratedDescription")}
                </span>
              </span>
            </label>
          </div>

          <Field label={t("dataDictionary.sourceTables")}>
            <Input
              value={draft.table ?? ""}
              onChange={(e) => set("table", e.target.value)}
              placeholder={t("dataDictionary.sourceTablesPlaceholder")}
            />
          </Field>

          <Field label={t("dataDictionary.columnsUsed")}>
            <Input
              value={draft.columnsUsed ?? ""}
              onChange={(e) => set("columnsUsed", e.target.value)}
              placeholder={t("dataDictionary.columnsUsedPlaceholder")}
            />
          </Field>

          <Field label={t("dataDictionary.standardCuts")}>
            <Input
              value={draft.cuts ?? ""}
              onChange={(e) => set("cuts", e.target.value)}
              placeholder={t("dataDictionary.standardCutsPlaceholder")}
            />
          </Field>

          <Field label={t("dataDictionary.queryTemplate")}>
            <Textarea
              value={draft.queryTemplate ?? ""}
              onChange={(e) => set("queryTemplate", e.target.value)}
              rows={5}
              className="font-mono text-xs"
              placeholder={t("dataDictionary.queryTemplatePlaceholder")}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label={t("dataDictionary.updateFrequency")}>
              <Input
                value={draft.updateFrequency ?? ""}
                onChange={(e) => set("updateFrequency", e.target.value)}
                placeholder={t("dataDictionary.updateFrequencyPlaceholder")}
              />
            </Field>
            <Field label={t("dataDictionary.dataLag")}>
              <Input
                value={draft.dataLag ?? ""}
                onChange={(e) => set("dataLag", e.target.value)}
                placeholder={t("dataDictionary.dataLagPlaceholder")}
              />
            </Field>
          </div>

          <Field label={t("dataDictionary.knownGotchas")}>
            <Textarea
              value={draft.knownGotchas ?? ""}
              onChange={(e) => set("knownGotchas", e.target.value)}
              rows={2}
              placeholder={t("dataDictionary.knownGotchasPlaceholder")}
            />
          </Field>

          <Field label={t("dataDictionary.commonQuestions")}>
            <Textarea
              value={draft.commonQuestions ?? ""}
              onChange={(e) => set("commonQuestions", e.target.value)}
              rows={2}
              placeholder={t("dataDictionary.commonQuestionsPlaceholder")}
            />
          </Field>

          <Field label={t("dataDictionary.exampleUseCase")}>
            <Textarea
              value={draft.exampleUseCase ?? ""}
              onChange={(e) => set("exampleUseCase", e.target.value)}
              rows={2}
              placeholder={t("dataDictionary.exampleUseCasePlaceholder")}
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("sidebar.cancel")}
          </Button>
          <Button
            onClick={() => onSave(draft)}
            disabled={
              saving || !draft.metric?.trim() || !draft.definition?.trim()
            }
          >
            {saving
              ? t("dataDictionary.saving")
              : t("dataDictionary.saveEntry")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
