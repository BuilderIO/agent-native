import { useMemo, useState } from "react";
import type { ComponentType } from "react";
import {
  IconArchive,
  IconFilter,
  IconLoader2,
  IconPencil,
  IconPlus,
  IconStar,
  IconTag,
  IconTrash,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useCreateGmailFilter,
  useDeleteGmailFilter,
  useGmailFilters,
  useReplaceGmailFilter,
  type ManageGmailFiltersInput,
} from "@/hooks/use-gmail-filters";
import type { ManagedGmailFilter } from "@shared/types";

type FilterFormState = {
  account: string;
  from: string;
  to: string;
  subject: string;
  query: string;
  label: string;
  forward: string;
  archive: boolean;
  markRead: boolean;
  starred: boolean;
  trash: boolean;
  createLabel: boolean;
};

const EMPTY_STATE: FilterFormState = {
  account: "",
  from: "",
  to: "",
  subject: "",
  query: "",
  label: "",
  forward: "",
  archive: true,
  markRead: false,
  starred: false,
  trash: false,
  createLabel: true,
};

const SYSTEM_LABEL_IDS = new Set(["IMPORTANT", "STARRED", "TRASH"]);

function userLabelName(filter?: ManagedGmailFilter) {
  return (
    filter?.actionLabels.find(
      (label) =>
        label.operation === "add" &&
        label.type !== "system" &&
        !SYSTEM_LABEL_IDS.has(label.id),
    )?.name ?? ""
  );
}

function initialState(
  accounts: string[],
  filter?: ManagedGmailFilter,
): FilterFormState {
  if (!filter) {
    return {
      ...EMPTY_STATE,
      account: accounts[0] ?? "",
    };
  }

  const add = new Set(filter.action.addLabelIds ?? []);
  const remove = new Set(filter.action.removeLabelIds ?? []);
  return {
    account: filter.accountEmail,
    from: filter.criteria.from ?? "",
    to: filter.criteria.to ?? "",
    subject: filter.criteria.subject ?? "",
    query: filter.criteria.query ?? "",
    label: userLabelName(filter),
    forward: filter.action.forward ?? "",
    archive: remove.has("INBOX"),
    markRead: remove.has("UNREAD"),
    starred: add.has("STARRED"),
    trash: add.has("TRASH"),
    createLabel: true,
  };
}

function compact(value: string) {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toPayload(
  state: FilterFormState,
  filter?: ManagedGmailFilter,
): Omit<ManageGmailFiltersInput, "operation"> {
  const replacing = Boolean(filter);
  return {
    account: compact(state.account),
    id: filter?.id,
    from: compact(state.from),
    to: compact(state.to),
    subject: compact(state.subject),
    query: compact(state.query),
    replaceCriteria: replacing ? true : undefined,
    archive: replacing ? state.archive : state.archive || undefined,
    markRead: replacing ? state.markRead : state.markRead || undefined,
    starred: replacing ? state.starred : state.starred || undefined,
    trash: replacing ? state.trash : state.trash || undefined,
    label: compact(state.label),
    createLabel: state.createLabel,
    forward: compact(state.forward),
    replaceAction: replacing ? true : undefined,
  };
}

function hasCriteria(state: FilterFormState) {
  return Boolean(
    compact(state.from) ||
    compact(state.to) ||
    compact(state.subject) ||
    compact(state.query),
  );
}

function hasAction(state: FilterFormState) {
  return Boolean(
    state.archive ||
    state.markRead ||
    state.starred ||
    state.trash ||
    compact(state.label) ||
    compact(state.forward),
  );
}

function FilterSwitch({
  icon: Icon,
  label,
  checked,
  onChange,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border border-border/20 bg-background/40 px-3 py-2">
      <span className="flex items-center gap-2 text-[13px] text-foreground">
        <Icon className="h-4 w-4 text-muted-foreground" />
        {label}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function FilterEditRow({
  filter,
  accounts,
  onSave,
  onCancel,
  isPending,
}: {
  filter?: ManagedGmailFilter;
  accounts: string[];
  onSave: (input: Omit<ManageGmailFiltersInput, "operation">) => void;
  onCancel: () => void;
  isPending?: boolean;
}) {
  const [state, setState] = useState(() => initialState(accounts, filter));
  const canSave = hasCriteria(state) && hasAction(state) && !isPending;

  const setField = <K extends keyof FilterFormState>(
    key: K,
    value: FilterFormState[K],
  ) => setState((current) => ({ ...current, [key]: value }));

  return (
    <div className="space-y-4 rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Account
          </label>
          <Select
            value={state.account}
            disabled={Boolean(filter) || accounts.length <= 1}
            onValueChange={(value) => setField("account", value)}
          >
            <SelectTrigger className="h-8 text-[13px]">
              <SelectValue placeholder="Select account" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((account) => (
                <SelectItem key={account} value={account}>
                  {account}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            From
          </label>
          <Input
            autoFocus
            value={state.from}
            onChange={(event) => setField("from", event.target.value)}
            placeholder="alerts@example.com"
            className="h-8 px-3 text-[13px]"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            To
          </label>
          <Input
            value={state.to}
            onChange={(event) => setField("to", event.target.value)}
            placeholder="me@example.com"
            className="h-8 px-3 text-[13px]"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Subject
          </label>
          <Input
            value={state.subject}
            onChange={(event) => setField("subject", event.target.value)}
            placeholder="Invoice"
            className="h-8 px-3 text-[13px]"
          />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Gmail search
        </label>
        <Textarea
          value={state.query}
          onChange={(event) => setField("query", event.target.value)}
          placeholder='from:alerts@example.com subject:("build failed")'
          rows={2}
          className="resize-none px-3 py-2 text-[13px]"
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <FilterSwitch
          icon={IconArchive}
          label="Archive"
          checked={state.archive}
          onChange={(value) => setField("archive", value)}
        />
        <FilterSwitch
          icon={IconFilter}
          label="Mark read"
          checked={state.markRead}
          onChange={(value) => setField("markRead", value)}
        />
        <FilterSwitch
          icon={IconStar}
          label="Star"
          checked={state.starred}
          onChange={(value) => setField("starred", value)}
        />
        <FilterSwitch
          icon={IconTrash}
          label="Trash"
          checked={state.trash}
          onChange={(value) => setField("trash", value)}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div>
          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Apply label
          </label>
          <Input
            value={state.label}
            onChange={(event) => setField("label", event.target.value)}
            placeholder="Receipts"
            className="h-8 px-3 text-[13px]"
          />
        </div>
        <label className="flex items-center gap-2 self-end pb-1.5 text-[12px] text-muted-foreground">
          <Switch
            checked={state.createLabel}
            onCheckedChange={(value) => setField("createLabel", value)}
          />
          Create label
        </label>
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={!canSave}
          onClick={() => onSave(toPayload(state, filter))}
        >
          {isPending && <IconLoader2 className="h-3.5 w-3.5 animate-spin" />}
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function FilterRow({
  filter,
  isEditing,
  accounts,
  onEdit,
  onCancelEdit,
}: {
  filter: ManagedGmailFilter;
  isEditing: boolean;
  accounts: string[];
  onEdit: () => void;
  onCancelEdit: () => void;
}) {
  const replaceFilter = useReplaceGmailFilter();
  const deleteFilter = useDeleteGmailFilter();
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (isEditing) {
    return (
      <FilterEditRow
        filter={filter}
        accounts={accounts}
        isPending={replaceFilter.isPending}
        onCancel={onCancelEdit}
        onSave={(input) =>
          replaceFilter.mutate(input, { onSuccess: onCancelEdit })
        }
      />
    );
  }

  return (
    <>
      <div className="group flex items-start gap-3 rounded-lg border border-border/30 bg-card px-4 py-3 hover:border-border/60">
        <div className="mt-0.5 rounded-md bg-indigo-500/10 p-1.5">
          <IconFilter className="h-4 w-4 text-indigo-300" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold text-foreground">
              {filter.criteriaSummary}
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {filter.accountEmail}
            </span>
          </div>
          <p className="text-[12px] text-muted-foreground">
            {filter.actionSummary}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={onEdit}
                className="h-7 w-7 p-0"
              >
                <IconPencil className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Edit filter</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setConfirmDelete(true)}
                disabled={deleteFilter.isPending}
                className="h-7 w-7 p-0"
              >
                {deleteFilter.isPending ? (
                  <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <IconTrash className="h-3.5 w-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete filter</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Gmail filter</AlertDialogTitle>
            <AlertDialogDescription>
              Delete this filter from {filter.accountEmail}? This changes Gmail
              directly.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteFilter.mutate(
                  { id: filter.id, account: filter.accountEmail },
                  {
                    onSuccess: () => {
                      setConfirmDelete(false);
                      onCancelEdit();
                    },
                  },
                )
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function GmailFiltersSection() {
  const { data, isLoading, error } = useGmailFilters();
  const createFilter = useCreateGmailFilter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

  const accounts = useMemo(
    () => data?.accounts.map((account) => account.accountEmail) ?? [],
    [data?.accounts],
  );
  const filters = useMemo(
    () => data?.accounts.flatMap((account) => account.filters) ?? [],
    [data?.accounts],
  );

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-[16px] font-semibold text-foreground">
            Gmail Filters
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Server-side Gmail rules for simple sender, subject, and search
            patterns.
          </p>
        </div>
        <Button
          size="sm"
          disabled={accounts.length === 0}
          onClick={() => {
            setShowNewForm(true);
            setEditingId(null);
          }}
        >
          <IconPlus className="h-3.5 w-3.5" />
          New filter
        </Button>
      </div>

      <div className="max-w-2xl space-y-2">
        {showNewForm && (
          <FilterEditRow
            accounts={accounts}
            isPending={createFilter.isPending}
            onCancel={() => setShowNewForm(false)}
            onSave={(input) =>
              createFilter.mutate(input, {
                onSuccess: () => setShowNewForm(false),
              })
            }
          />
        )}

        {isLoading &&
          Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="flex items-center gap-3 rounded-lg border border-border/20 bg-card/50 p-3"
            >
              <Skeleton className="h-8 w-8 rounded-md" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-48" />
                <Skeleton className="h-3 w-64" />
              </div>
              <Skeleton className="h-7 w-16 rounded-md" />
            </div>
          ))}

        {error && !isLoading && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-[13px] text-destructive">
            {(error as Error).message}
          </div>
        )}

        {!isLoading && !error && filters.length === 0 && !showNewForm && (
          <div className="rounded-lg border border-border/20 bg-card/50 py-12 text-center">
            <IconTag className="mx-auto mb-3 h-8 w-8 text-muted-foreground/20" />
            <p className="text-[13px] text-muted-foreground/50">
              No Gmail filters yet.
            </p>
          </div>
        )}

        {filters.map((filter) => (
          <FilterRow
            key={`${filter.accountEmail}:${filter.id}`}
            filter={filter}
            accounts={accounts}
            isEditing={editingId === `${filter.accountEmail}:${filter.id}`}
            onEdit={() => {
              setEditingId(`${filter.accountEmail}:${filter.id}`);
              setShowNewForm(false);
            }}
            onCancelEdit={() => setEditingId(null)}
          />
        ))}
      </div>
    </div>
  );
}
