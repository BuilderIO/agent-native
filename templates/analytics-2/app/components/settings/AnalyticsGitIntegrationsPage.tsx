import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { SettingsGroup } from "@agent-native/toolkit/app/settings";
import { Skeleton } from "@agent-native/toolkit/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  EMPTY_GIT_INTEGRATIONS,
  GIT_INTEGRATIONS_SECTION_IDS,
  GIT_PROVIDER_LABELS,
  GIT_PROVIDERS,
  isValidBranchName,
  isValidRepositorySlug,
  isValidSubdirPath,
  type GitIntegrationsSettings,
  type GitProvider,
} from "@/lib/model/git-integrations-contracts";

function makeEntryId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${random}`;
}

function hasDuplicate(
  entries: ReadonlyArray<{
    provider: GitProvider;
    repository: string;
    branch: string;
  }>,
  provider: GitProvider,
  repository: string,
  branch: string,
): boolean {
  const normalized = repository.trim().toLowerCase();
  return entries.some(
    (item) =>
      item.provider === provider &&
      item.repository.toLowerCase() === normalized &&
      item.branch === branch.trim(),
  );
}

export function AnalyticsGitIntegrationsPage() {
  const t = useT();
  const label = (key: string) => t(`analytics.gitIntegrations.${key}`);
  const queryClient = useQueryClient();
  const shell = useActionQuery("get-workspace-bootstrap", {}, { retry: 1 });
  const isAdmin = shell.data?.features.isAdmin === true;
  const query = useActionQuery("get-git-integrations", {});

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [addingKind, setAddingKind] = useState<
    "packageImport" | "projectExport" | "repoSync" | null
  >(null);
  const [provider, setProvider] = useState<GitProvider>("github");
  const [repository, setRepository] = useState("");
  const [branch, setBranch] = useState("main");
  const [pathValue, setPathValue] = useState("");
  const [exportOnPublish, setExportOnPublish] = useState(true);
  const [formError, setFormError] = useState("");

  const loading = query.isLoading;
  const unreadable = query.isError || (!loading && !query.data);
  const current: GitIntegrationsSettings = query.data ?? EMPTY_GIT_INTEGRATIONS;

  const resetForm = () => {
    setAddingKind(null);
    setProvider("github");
    setRepository("");
    setBranch("main");
    setPathValue("");
    setExportOnPublish(true);
    setFormError("");
  };

  const openForm = (kind: "packageImport" | "projectExport" | "repoSync") => {
    setProvider("github");
    setRepository("");
    setBranch("main");
    setPathValue("");
    setExportOnPublish(true);
    setFormError("");
    setSaveError("");
    setAddingKind(kind);
  };

  const persist = async (next: GitIntegrationsSettings): Promise<boolean> => {
    if (!isAdmin || unreadable) return false;
    setSaving(true);
    setSaveError("");
    try {
      await callAction("save-git-integrations", next);
      await queryClient.invalidateQueries({ queryKey: ["action"] });
      return true;
    } catch {
      setSaveError(label("saveError"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>,
    kind: "packageImport" | "projectExport" | "repoSync",
  ) => {
    event.preventDefault();
    const trimmedRepo = repository.trim();
    const trimmedBranch = branch.trim();
    const trimmedPath = pathValue.trim();

    if (!isValidRepositorySlug(trimmedRepo)) {
      setFormError(label("invalidRepository"));
      return;
    }
    if (!isValidBranchName(trimmedBranch)) {
      setFormError(label("invalidBranch"));
      return;
    }
    if (kind !== "repoSync" && !isValidSubdirPath(trimmedPath)) {
      setFormError(label("invalidPath"));
      return;
    }

    const existing =
      kind === "packageImport"
        ? current.packageImports
        : kind === "projectExport"
          ? current.projectExports
          : current.repoSyncs;
    if (hasDuplicate(existing, provider, trimmedRepo, trimmedBranch)) {
      setFormError(label("duplicateEntry"));
      return;
    }

    setFormError("");
    const createdAt = new Date().toISOString();
    const next: GitIntegrationsSettings =
      kind === "packageImport"
        ? {
            ...current,
            packageImports: [
              ...current.packageImports,
              {
                id: makeEntryId("pkg"),
                provider,
                repository: trimmedRepo,
                branch: trimmedBranch,
                subdir: trimmedPath,
                createdAt,
              },
            ],
          }
        : kind === "projectExport"
          ? {
              ...current,
              projectExports: [
                ...current.projectExports,
                {
                  id: makeEntryId("exp"),
                  provider,
                  repository: trimmedRepo,
                  branch: trimmedBranch,
                  directory: trimmedPath,
                  exportOnPublish,
                  createdAt,
                },
              ],
            }
          : {
              ...current,
              repoSyncs: [
                ...current.repoSyncs,
                {
                  id: makeEntryId("sync"),
                  provider,
                  repository: trimmedRepo,
                  branch: trimmedBranch,
                  enabled: true,
                  createdAt,
                },
              ],
            };

    if (await persist(next)) {
      resetForm();
    }
  };

  const renderForm = (kind: "packageImport" | "projectExport" | "repoSync") => (
    <form
      className="mt-3 space-y-3 rounded-lg border border-border bg-muted/30 p-4"
      onSubmit={(event) => void handleSubmit(event, kind)}
      noValidate
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor={`git-provider-${kind}`}>
            {label("providerLabel")}
          </Label>
          <select
            id={`git-provider-${kind}`}
            name="provider"
            value={provider}
            disabled={saving}
            onChange={(event) => setProvider(event.target.value as GitProvider)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs"
          >
            {GIT_PROVIDERS.map((value) => (
              <option key={value} value={value}>
                {GIT_PROVIDER_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`git-repo-${kind}`}>{label("repositoryLabel")}</Label>
          <Input
            id={`git-repo-${kind}`}
            name="repository"
            value={repository}
            disabled={saving}
            placeholder={label("repositoryPlaceholder")}
            onChange={(event) => setRepository(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`git-branch-${kind}`}>{label("branchLabel")}</Label>
          <Input
            id={`git-branch-${kind}`}
            name="branch"
            value={branch}
            disabled={saving}
            placeholder={label("branchPlaceholder")}
            onChange={(event) => setBranch(event.target.value)}
          />
        </div>
      </div>

      {kind === "packageImport" ? (
        <div className="space-y-1">
          <Label htmlFor="git-subdir-package">{label("subdirLabel")}</Label>
          <Input
            id="git-subdir-package"
            name="subdir"
            value={pathValue}
            disabled={saving}
            placeholder={label("subdirPlaceholder")}
            onChange={(event) => setPathValue(event.target.value)}
          />
        </div>
      ) : null}

      {kind === "projectExport" ? (
        <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
          <div className="space-y-1">
            <Label htmlFor="git-dir-export">{label("directoryLabel")}</Label>
            <Input
              id="git-dir-export"
              name="directory"
              value={pathValue}
              disabled={saving}
              placeholder={label("directoryPlaceholder")}
              onChange={(event) => setPathValue(event.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <Checkbox
              checked={exportOnPublish}
              disabled={saving}
              onCheckedChange={(checked) =>
                setExportOnPublish(checked === true)
              }
            />
            <span>{label("exportOnPublishLabel")}</span>
          </label>
        </div>
      ) : null}

      {formError ? (
        <p className="text-sm text-destructive" role="alert">
          {formError}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {label("save")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={saving}
          onClick={resetForm}
        >
          {label("cancel")}
        </Button>
      </div>
    </form>
  );

  if (loading) {
    return (
      <div className="space-y-4" data-testid="git-integrations">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  if (unreadable) {
    return (
      <div className="space-y-3 py-2" data-testid="git-integrations">
        <p className="text-sm text-destructive" role="alert">
          {label("loadError")}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="git-integrations-retry"
          onClick={() => void query.refetch()}
        >
          {label("retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="git-integrations">
      {!isAdmin ? (
        <p className="text-sm text-muted-foreground">{label("adminNotice")}</p>
      ) : null}
      {saveError ? (
        <p className="text-sm text-destructive" role="alert">
          {saveError}
        </p>
      ) : null}

      <section id={GIT_INTEGRATIONS_SECTION_IDS.packageImport}>
        <SettingsGroup title={label("packageImport.title")}>
          <div className="space-y-3 px-4 py-3">
            <div className="flex items-start justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                {label("packageImport.description")}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="add-package-import-btn"
                disabled={!isAdmin || saving}
                onClick={() => openForm("packageImport")}
              >
                {label("packageImport.add")}
              </Button>
            </div>
            {current.packageImports.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {label("packageImport.empty")}
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {current.packageImports.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between gap-4 px-3 py-2.5"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">
                          {GIT_PROVIDER_LABELS[entry.provider]}
                        </Badge>
                        <span className="truncate text-sm font-medium">
                          {entry.repository}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {entry.branch}
                        {entry.subdir ? ` · ${entry.subdir}` : ""}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      data-testid={`remove-package-import-${entry.id}`}
                      disabled={!isAdmin || saving}
                      onClick={() =>
                        void persist({
                          ...current,
                          packageImports: current.packageImports.filter(
                            (item) => item.id !== entry.id,
                          ),
                        })
                      }
                    >
                      {label("remove")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {addingKind === "packageImport"
              ? renderForm("packageImport")
              : null}
          </div>
        </SettingsGroup>
      </section>

      <section id={GIT_INTEGRATIONS_SECTION_IDS.projectExport}>
        <SettingsGroup title={label("projectExport.title")}>
          <div className="space-y-3 px-4 py-3">
            <div className="flex items-start justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                {label("projectExport.description")}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="add-project-export-btn"
                disabled={!isAdmin || saving}
                onClick={() => openForm("projectExport")}
              >
                {label("projectExport.add")}
              </Button>
            </div>
            {current.projectExports.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {label("projectExport.empty")}
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {current.projectExports.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between gap-4 px-3 py-2.5"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">
                          {GIT_PROVIDER_LABELS[entry.provider]}
                        </Badge>
                        <span className="truncate text-sm font-medium">
                          {entry.repository}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {entry.branch}
                        {entry.directory ? ` · ${entry.directory}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{label("exportOnPublishLabel")}</span>
                        <Switch
                          checked={entry.exportOnPublish}
                          disabled={!isAdmin || saving}
                          aria-label={`${label("exportOnPublishLabel")} ${entry.repository}`}
                          onCheckedChange={(checked) =>
                            void persist({
                              ...current,
                              projectExports: current.projectExports.map(
                                (item) =>
                                  item.id === entry.id
                                    ? { ...item, exportOnPublish: checked }
                                    : item,
                              ),
                            })
                          }
                        />
                      </label>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        data-testid={`remove-project-export-${entry.id}`}
                        disabled={!isAdmin || saving}
                        onClick={() =>
                          void persist({
                            ...current,
                            projectExports: current.projectExports.filter(
                              (item) => item.id !== entry.id,
                            ),
                          })
                        }
                      >
                        {label("remove")}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {addingKind === "projectExport"
              ? renderForm("projectExport")
              : null}
          </div>
        </SettingsGroup>
      </section>

      <section id={GIT_INTEGRATIONS_SECTION_IDS.repoSync}>
        <SettingsGroup title={label("repoSync.title")}>
          <div className="space-y-3 px-4 py-3">
            <div className="flex items-start justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                {label("repoSync.description")}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="add-repo-sync-btn"
                disabled={!isAdmin || saving}
                onClick={() => openForm("repoSync")}
              >
                {label("repoSync.add")}
              </Button>
            </div>
            {current.repoSyncs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {label("repoSync.empty")}
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {current.repoSyncs.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between gap-4 px-3 py-2.5"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">
                          {GIT_PROVIDER_LABELS[entry.provider]}
                        </Badge>
                        <span className="truncate text-sm font-medium">
                          {entry.repository}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {entry.branch}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{label("syncEnabledLabel")}</span>
                        <Switch
                          checked={entry.enabled}
                          disabled={!isAdmin || saving}
                          aria-label={`${label("syncEnabledLabel")} ${entry.repository}`}
                          onCheckedChange={(checked) =>
                            void persist({
                              ...current,
                              repoSyncs: current.repoSyncs.map((item) =>
                                item.id === entry.id
                                  ? { ...item, enabled: checked }
                                  : item,
                              ),
                            })
                          }
                        />
                      </label>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        data-testid={`remove-repo-sync-${entry.id}`}
                        disabled={!isAdmin || saving}
                        onClick={() =>
                          void persist({
                            ...current,
                            repoSyncs: current.repoSyncs.filter(
                              (item) => item.id !== entry.id,
                            ),
                          })
                        }
                      >
                        {label("remove")}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {addingKind === "repoSync" ? renderForm("repoSync") : null}
          </div>
        </SettingsGroup>
      </section>
    </div>
  );
}
