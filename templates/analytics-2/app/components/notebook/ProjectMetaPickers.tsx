import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconChevronDown, IconLock } from "@tabler/icons-react";
import { useRef, useState } from "react";

import { OrganizationCatalogForm } from "@/components/settings/OrganizationCatalogForm";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * What this picker has established that the server read may not show yet: the
 * selected (or last accepted) value, and the read keys that predate it.
 */
interface Held<T> {
  value: T;
  stale: string[];
  writing: boolean;
}

/**
 * The held value while the read is still behind it. A read that reports the
 * held value has caught up. A read that reports one of the stale keys is an
 * earlier answer arriving late. Any other read is a change from outside.
 */
function stillHeld<T>(
  held: Held<T> | null,
  serverKey: string,
  key: (value: T) => string,
): Held<T> | null {
  if (held == null) return null;
  if (held.writing) return held;
  if (key(held.value) === serverKey) return null;
  return held.stale.includes(serverKey) ? held : null;
}

/**
 * A full-value write whose latest selection always wins. Selections show at
 * once; only one write is in flight, and a selection made meanwhile is written
 * after it settles. A failed write rolls back to the last value the server
 * accepted, never past a newer selection that is still waiting. The accepted
 * value shows until the read reports it or reports a change from outside.
 */
function useLatestWins<T>({
  server,
  key,
  write,
  onFailure,
}: {
  server: T;
  key: (value: T) => string;
  write: (value: T) => Promise<unknown>;
  onFailure: (cause: unknown) => void;
}) {
  const [held, setHeld] = useState<Held<T> | null>(null);
  const serverKey = key(server);
  const active = stillHeld(held, serverKey, key);
  if (held != null && active == null) setHeld(null);
  const applied = active != null ? active.value : server;
  const state = useRef<{
    writing: boolean;
    queued: { value: T } | null;
    latest: T;
    confirmed: T;
  }>({ writing: false, queued: null, latest: applied, confirmed: server });
  const live = useRef({ server, active, write, onFailure });
  live.current = { server, active, write, onFailure };

  async function drain() {
    const run = state.current;
    let failure: { cause: unknown } | null = null;
    while (run.queued != null) {
      const { value } = run.queued;
      run.queued = null;
      try {
        await live.current.write(value);
        run.confirmed = value;
        failure = null;
      } catch (cause) {
        failure = { cause };
      }
    }
    run.writing = false;
    if (failure != null) {
      run.latest = run.confirmed;
      setHeld((current) => ({
        value: run.confirmed,
        stale: current?.stale ?? [],
        writing: false,
      }));
      live.current.onFailure(failure.cause);
    } else {
      setHeld((current) =>
        current == null ? current : { ...current, writing: false },
      );
    }
  }

  function select(next: T) {
    const run = state.current;
    const { server: base, active: before } = live.current;
    if (!run.writing && before == null) run.confirmed = base;
    run.latest = next;
    run.queued = { value: next };
    setHeld({
      value: next,
      stale: [
        ...new Set([
          ...(before?.stale ?? []),
          key(base),
          ...(before == null ? [] : [key(before.value)]),
        ]),
      ],
      writing: true,
    });
    if (run.writing) return;
    run.writing = true;
    void drain();
  }

  return {
    applied,
    current: () => (state.current.writing ? state.current.latest : applied),
    select,
  };
}

export function ProjectMetaPickers({
  projectId,
  statusId,
  canEdit,
}: {
  projectId: string;
  statusId: string | null;
  canEdit: boolean;
}) {
  const t = useT();
  const statusesQuery = useActionQuery("list-data-statuses", {});
  const categoriesQuery = useActionQuery("list-project-categories", {
    projectId,
  });
  const shellQuery = useActionQuery("get-workspace-shell", {}, { retry: 1 });
  const updateProject = useActionMutation("update-project", {
    errorNotification: "caller",
  });
  const updateCategories = useActionMutation("update-project-categories", {
    errorNotification: "caller",
  });
  const createStatus = useActionMutation("create-data-status", {
    errorNotification: "caller",
  });
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const statuses = statusesQuery.data?.statuses ?? [];
  const categories = categoriesQuery.data?.categories ?? [];
  const isManagerOrAbove = shellQuery.data?.features.isManagerOrAbove === true;
  const isAdmin = shellQuery.data?.features.isAdmin === true;

  const status = useLatestWins<string | null>({
    server: statusId,
    key: (value) => value ?? "",
    write: (value) => updateProject.mutateAsync({ projectId, statusId: value }),
    onFailure: (cause) =>
      setError(
        actionErrorMessage(cause) ?? t("notebook.metaPickers.statusSaveFailed"),
      ),
  });
  const serverCategoryIds =
    categoriesQuery.data?.assignments.find(
      (assignment) => assignment.projectId === projectId,
    )?.categoryIds ?? [];
  const category = useLatestWins<string[]>({
    server: serverCategoryIds,
    key: (value) => [...value].sort().join("\n"),
    write: (value) =>
      updateCategories.mutateAsync({ projectId, categoryIds: value }),
    onFailure: (cause) =>
      setError(
        actionErrorMessage(cause) ??
          t("notebook.metaPickers.categoriesSaveFailed"),
      ),
  });

  const appliedStatusId = status.applied;
  const appliedStatus =
    statuses.find((candidate) => candidate.id === appliedStatusId) ?? null;
  const appliedCategoryIds = category.applied;
  const appliedCategories = categories.filter((candidate) =>
    appliedCategoryIds.includes(candidate.id),
  );

  function selectStatus(next: string | null) {
    setError(null);
    status.select(next);
  }

  function toggleCategory(categoryId: string, checked: boolean) {
    const previous = category.current();
    setError(null);
    category.select(
      checked
        ? [...previous.filter((id) => id !== categoryId), categoryId]
        : previous.filter((id) => id !== categoryId),
    );
  }

  const hasStatus = appliedStatusId != null;
  const hasCategories = appliedCategoryIds.length > 0;
  if (!canEdit && !hasStatus && !hasCategories) return null;

  const statusLoading = statusesQuery.isPending && hasStatus;
  const categoriesLoading = categoriesQuery.isPending && hasCategories;
  const statusLabel =
    appliedStatus?.name ?? t("notebook.metaPickers.addStatus");
  const categoriesLabel =
    appliedCategories.length > 0
      ? appliedCategories.map((candidate) => candidate.name).join(", ")
      : t("notebook.metaPickers.addCategories");
  const open = statuses.filter((candidate) => !candidate.endorsed);
  const endorsed = statuses.filter((candidate) => candidate.endorsed);

  return (
    <>
      <div className="nb-empty-meta">
        {statusLoading ? (
          <Skeleton className="h-6 w-24" />
        ) : canEdit ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="nb-empty-meta-button"
                disabled={statusesQuery.isPending || statusesQuery.isError}
              >
                {statusLabel}
                {hasStatus ? null : (
                  <IconChevronDown size={12} aria-hidden="true" />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {hasStatus ? (
                <>
                  <DropdownMenuItem onSelect={() => selectStatus(null)}>
                    {t("notebook.metaPickers.clearStatus")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              ) : null}
              <DropdownMenuRadioGroup
                value={appliedStatusId ?? ""}
                onValueChange={(value) => selectStatus(value)}
              >
                {open.map((candidate) => (
                  <DropdownMenuRadioItem
                    key={candidate.id}
                    value={candidate.id}
                  >
                    {candidate.name}
                  </DropdownMenuRadioItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>
                  {t("notebook.metaPickers.endorsedStatuses")}
                  {isManagerOrAbove ? null : (
                    <IconLock size={12} aria-hidden="true" />
                  )}
                </DropdownMenuLabel>
                {endorsed.length === 0 ? (
                  <DropdownMenuLabel>
                    {t("notebook.metaPickers.none")}
                  </DropdownMenuLabel>
                ) : null}
                {endorsed.map((candidate) => (
                  <DropdownMenuRadioItem
                    key={candidate.id}
                    value={candidate.id}
                    disabled={!isManagerOrAbove}
                  >
                    {candidate.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              {isAdmin ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setCreating(true)}>
                    {t("notebook.metaPickers.newStatus")}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : hasStatus ? (
          <span className="nb-empty-meta-button">{statusLabel}</span>
        ) : null}
        {categoriesLoading ? (
          <Skeleton className="h-6 w-32" />
        ) : canEdit ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="nb-empty-meta-button"
                disabled={categoriesQuery.isPending || categoriesQuery.isError}
              >
                {categoriesLabel}
                {hasCategories ? null : (
                  <IconChevronDown size={12} aria-hidden="true" />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {categories.length === 0 ? (
                <DropdownMenuLabel>
                  {t("notebook.metaPickers.noCategories")}
                </DropdownMenuLabel>
              ) : null}
              {categories.map((candidate) => (
                <DropdownMenuCheckboxItem
                  key={candidate.id}
                  checked={appliedCategoryIds.includes(candidate.id)}
                  title={candidate.description || undefined}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(checked) =>
                    toggleCategory(candidate.id, checked === true)
                  }
                >
                  {candidate.name}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : hasCategories ? (
          <span className="nb-empty-meta-button">{categoriesLabel}</span>
        ) : null}
      </div>
      {statusesQuery.isError || categoriesQuery.isError ? (
        <p role="alert">{t("notebook.metaPickers.loadFailed")}</p>
      ) : null}
      {error != null ? <p role="alert">{error}</p> : null}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>
            {t("analytics.organizationCatalog.newStatus")}
          </DialogTitle>
          <OrganizationCatalogForm
            isStatus
            showLibrary={statuses.some(
              (candidate) => candidate.inLibrary && !candidate.endorsed,
            )}
            names={statuses.map((candidate) => candidate.name)}
            close={() => setCreating(false)}
            save={async (values) => {
              const created = await createStatus.mutateAsync(values);
              selectStatus(created.status.id);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
