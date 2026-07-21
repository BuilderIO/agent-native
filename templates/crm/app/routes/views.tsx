import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { Badge } from "@agent-native/toolkit/ui/badge";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@agent-native/toolkit/ui/dialog";
import { Input } from "@agent-native/toolkit/ui/input";
import { Label } from "@agent-native/toolkit/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { IconBookmark, IconPlus } from "@tabler/icons-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import {
  LoadingRows,
  PageHeader,
  SetupEmptyState,
} from "@/components/crm/Surface";
import { asText, type CrmKind, type CrmSavedView } from "@/lib/types";

export default function SavedViewsRoute() {
  const viewsQuery = useActionQuery<unknown>(
    "list-crm-saved-views" as never,
    {} as never,
  );
  const views = normalizeSavedViews(viewsQuery.data);
  return (
    <>
      <PageHeader
        eyebrow="CRM"
        title="Saved views"
        description="Executable, permission-aware slices with optional data-program context."
        actions={<CreateSavedViewDialog />}
      />
      {viewsQuery.isLoading ? (
        <LoadingRows rows={5} />
      ) : views.length ? (
        <div className="grid gap-2 p-5 sm:grid-cols-2 sm:p-7 xl:grid-cols-3">
          {views.map((view) => (
            <Link
              key={view.id}
              to={`/${kindRoute(view.kind)}?view=${encodeURIComponent(view.id)}`}
              className="group rounded-lg border border-border/70 bg-card p-4 transition-colors hover:bg-muted/50"
            >
              <div className="flex items-start gap-3">
                <IconBookmark className="mt-0.5 size-4 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{view.name}</p>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {view.description || view.query || "Saved CRM view"}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {view.kind ? (
                      <Badge
                        variant="secondary"
                        className="capitalize font-normal"
                      >
                        {view.kind}s
                      </Badge>
                    ) : null}
                    {view.dataProgramId ? (
                      <Badge variant="outline" className="font-normal">
                        Data program
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <SetupEmptyState
          title="No saved views yet"
          description="Create a focused view with a record type, search, field filters, and optional data-program context."
        />
      )}
    </>
  );
}

function CreateSavedViewDialog() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<CrmKind>("account");
  const [query, setQuery] = useState("");
  const [field, setField] = useState("");
  const [value, setValue] = useState("");
  const [dataProgramId, setDataProgramId] = useState("");
  const save = useActionMutation<
    { id: string },
    {
      name: string;
      description?: string;
      kind: CrmKind;
      filters?: Record<string, unknown>;
      sort: Array<{ field: string; direction: "desc" }>;
      dataProgramId?: string;
    }
  >("save-crm-saved-view" as never);

  async function saveView() {
    const filters: Record<string, unknown> = {};
    if (query.trim()) filters.query = query.trim();
    if (field.trim() && value.trim()) {
      filters.fieldEquals = { [field.trim()]: value.trim() };
    }
    try {
      const saved = await save.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        kind,
        filters: Object.keys(filters).length ? filters : undefined,
        sort: [{ field: "updatedAt", direction: "desc" }],
        dataProgramId: dataProgramId.trim() || undefined,
      });
      setOpen(false);
      toast.success("Saved view created.");
      navigate(`/${kindRoute(kind)}?view=${encodeURIComponent(saved.id)}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "View could not be saved.",
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <IconPlus className="size-4" /> New view
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create saved view</DialogTitle>
          <DialogDescription>
            Views store bounded filters and presentation settings, not provider
            rows.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <Field label="Name" htmlFor="view-name" className="sm:col-span-2">
            <Input
              id="view-name"
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field
            label="Description"
            htmlFor="view-description"
            className="sm:col-span-2"
          >
            <Input
              id="view-description"
              value={description}
              maxLength={500}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          <Field label="Record type" htmlFor="view-kind">
            <Select
              value={kind}
              onValueChange={(next) => setKind(next as CrmKind)}
            >
              <SelectTrigger id="view-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="account">Accounts</SelectItem>
                <SelectItem value="person">People</SelectItem>
                <SelectItem value="opportunity">Opportunities</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Search" htmlFor="view-query">
            <Input
              id="view-query"
              value={query}
              maxLength={120}
              placeholder="Name contains…"
              onChange={(event) => setQuery(event.target.value)}
            />
          </Field>
          <Field label="Field" htmlFor="view-field">
            <Input
              id="view-field"
              value={field}
              maxLength={120}
              placeholder="stage"
              onChange={(event) => setField(event.target.value)}
            />
          </Field>
          <Field label="Equals" htmlFor="view-value">
            <Input
              id="view-value"
              value={value}
              maxLength={240}
              placeholder="Qualified"
              onChange={(event) => setValue(event.target.value)}
            />
          </Field>
          <Field
            label="Data program ID"
            htmlFor="view-program"
            className="sm:col-span-2"
          >
            <Input
              id="view-program"
              value={dataProgramId}
              maxLength={128}
              placeholder="Optional saved cross-source program"
              onChange={(event) => setDataProgramId(event.target.value)}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button
            disabled={!name.trim() || save.isPending}
            onClick={() => void saveView()}
          >
            Save and open
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`grid gap-2 ${className ?? ""}`}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function normalizeSavedViews(data: unknown): CrmSavedView[] {
  const entries =
    data &&
    typeof data === "object" &&
    Array.isArray((data as { views?: unknown[] }).views)
      ? (data as { views: unknown[] }).views
      : [];
  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const id = asText(item.id);
    const name = asText(item.name);
    if (!id || !name) return [];
    return [
      {
        id,
        name,
        description: asText(item.description),
        kind: asKind(item.kind),
        query: readableFilters(item.filters ?? item.query),
        dataProgramId: asText(item.dataProgramId),
      },
    ];
  });
}

function readableFilters(value: unknown) {
  if (typeof value === "string") {
    try {
      return readableFilters(JSON.parse(value) as unknown);
    } catch {
      return value;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  return Object.entries(value)
    .slice(0, 4)
    .map(([key, entry]) => `${key}: ${String(entry)}`)
    .join(" · ");
}

function asKind(value: unknown): CrmKind | undefined {
  return value === "account" || value === "person" || value === "opportunity"
    ? value
    : undefined;
}

function kindRoute(kind: CrmKind | undefined) {
  return kind === "person"
    ? "people"
    : kind === "opportunity"
      ? "opportunities"
      : "accounts";
}
