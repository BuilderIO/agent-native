import { useMemo, useState } from "react";
import {
  useActionQuery,
  useActionMutation,
  useSendToAgentChat,
} from "@agent-native/core/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  IconBook2,
  IconPencil,
  IconPlus,
  IconTrash,
  IconSearch,
  IconExternalLink,
} from "@tabler/icons-react";
import { useSetHeaderActions } from "@/components/layout/HeaderActions";

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
};

const DEPARTMENT_BADGE: Record<string, string> = {
  Sales: "bg-green-500/10 text-green-600 dark:text-green-400",
  Marketing: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  Product: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  Data: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  Finance: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  Engineering: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
};

function deptClass(dept?: string): string {
  if (!dept) return "bg-muted text-muted-foreground";
  return DEPARTMENT_BADGE[dept] ?? "bg-muted text-muted-foreground";
}

export default function DataDictionary() {
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
      New entry
    </Button>,
  );

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground max-w-2xl">
        The catalog of metrics, tables, and business definitions the analytics
        agent uses when building dashboards from prompts. Keep entries accurate
        and the agent will stop guessing about your data.
      </p>

      <div className="relative max-w-md">
        <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search metrics, definitions…"
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
            <h3 className="text-lg font-semibold mb-2">No entries yet</h3>
            <p className="text-sm text-muted-foreground max-w-md mb-4">
              Define the metrics and tables your team uses most. The agent reads
              these before writing SQL so dashboards match your definitions —
              not its guesses.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setEditing({ ...EMPTY_ENTRY })}
              >
                <IconPlus className="h-4 w-4 mr-1" />
                Add an entry
              </Button>
              <Button
                variant="ghost"
                onClick={() =>
                  send({
                    message:
                      "Help me populate the data dictionary. Ask me where my team's metric definitions currently live (docs, spreadsheets, dbt, Notion, Confluence, a wiki, etc.) and then save each one via the save-data-dictionary-entry action.",
                    submit: false,
                  })
                }
              >
                Ask the agent to help populate it
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
                    <Badge
                      variant="outline"
                      className={`text-[10px] px-1.5 py-0 ${deptClass(e.department)} border-0`}
                    >
                      {e.department}
                    </Badge>
                  )}
                  {e.table && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 font-mono"
                    >
                      {e.table}
                    </Badge>
                  )}
                  {e.approved && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 bg-green-500/10 text-green-600 dark:text-green-400 border-0"
                    >
                      approved
                    </Badge>
                  )}
                  {e.aiGenerated && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 bg-purple-500/10 text-purple-600 dark:text-purple-400 border-0"
                    >
                      AI
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
                    source
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
          await save.mutateAsync(entry);
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
            <AlertDialogTitle>Delete "{toDelete?.metric}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the entry from the data dictionary. The agent will no
              longer consult this definition when building dashboards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (toDelete) {
                  await remove.mutateAsync({ id: toDelete.id });
                  setToDelete(null);
                }
              }}
            >
              Delete
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
            {entry?.id ? "Edit entry" : "New dictionary entry"}
          </DialogTitle>
          <DialogDescription>
            Document a metric, table, or concept the analytics agent should know
            about.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <Field label="Metric" required>
            <Input
              value={draft.metric ?? ""}
              onChange={(e) => set("metric", e.target.value)}
              placeholder="e.g. Active Paying Accounts"
            />
          </Field>
          <Field label="Definition" required>
            <Textarea
              value={draft.definition ?? ""}
              onChange={(e) => set("definition", e.target.value)}
              rows={3}
              placeholder="Plain-English description of what this metric means"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Department">
              <Input
                value={draft.department ?? ""}
                onChange={(e) => set("department", e.target.value)}
                placeholder="Sales / Marketing / Product / Data"
              />
            </Field>
            <Field label="Owner">
              <Input
                value={draft.owner ?? ""}
                onChange={(e) => set("owner", e.target.value)}
                placeholder="e.g. data-team@"
              />
            </Field>
          </div>

          <Field label="Source table(s)">
            <Input
              value={draft.table ?? ""}
              onChange={(e) => set("table", e.target.value)}
              placeholder="e.g. analytics.fact_signups"
            />
          </Field>

          <Field label="Columns used">
            <Input
              value={draft.columnsUsed ?? ""}
              onChange={(e) => set("columnsUsed", e.target.value)}
              placeholder="e.g. user_id, signup_at, plan_tier"
            />
          </Field>

          <Field label="Standard cuts / dimensions">
            <Input
              value={draft.cuts ?? ""}
              onChange={(e) => set("cuts", e.target.value)}
              placeholder="e.g. week, channel, region"
            />
          </Field>

          <Field label="Query template">
            <Textarea
              value={draft.queryTemplate ?? ""}
              onChange={(e) => set("queryTemplate", e.target.value)}
              rows={5}
              className="font-mono text-xs"
              placeholder="SELECT date_trunc('week', signup_at) AS week, COUNT(*) …"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Update frequency">
              <Input
                value={draft.updateFrequency ?? ""}
                onChange={(e) => set("updateFrequency", e.target.value)}
                placeholder="hourly / daily"
              />
            </Field>
            <Field label="Data lag">
              <Input
                value={draft.dataLag ?? ""}
                onChange={(e) => set("dataLag", e.target.value)}
                placeholder="~15min / next day"
              />
            </Field>
          </div>

          <Field label="Known gotchas">
            <Textarea
              value={draft.knownGotchas ?? ""}
              onChange={(e) => set("knownGotchas", e.target.value)}
              rows={2}
              placeholder="Edge cases, nulls, known data quality issues"
            />
          </Field>

          <Field label="Common questions">
            <Textarea
              value={draft.commonQuestions ?? ""}
              onChange={(e) => set("commonQuestions", e.target.value)}
              rows={2}
              placeholder="Frequently-asked questions about this metric"
            />
          </Field>

          <Field label="Example use case">
            <Textarea
              value={draft.exampleUseCase ?? ""}
              onChange={(e) => set("exampleUseCase", e.target.value)}
              rows={2}
              placeholder="When should someone reach for this metric?"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={() => onSave(draft)}
            disabled={
              saving || !draft.metric?.trim() || !draft.definition?.trim()
            }
          >
            {saving ? "Saving…" : "Save entry"}
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
