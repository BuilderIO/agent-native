import { useT } from "@agent-native/core/client/i18n";
import type { RelationshipTypeVersion } from "@shared/relationships";
import { IconArrowRight, IconCheck, IconSearch } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useContentDatabases } from "@/hooks/use-content-database";
import {
  contentRelationshipOperationId,
  isSupersededRelationshipMutationError,
  relationshipMutationErrorMessage,
  useConfigureContentRelationProperty,
  useContentRelationshipTypes,
} from "@/hooks/use-content-relationships";
import { useRelationshipAppState } from "@/hooks/use-relationship-app-state";
import { cn } from "@/lib/utils";

export function relationshipDirectionForDatabase(
  version: RelationshipTypeVersion,
  databaseId: string,
) {
  if (version.sourceDatabaseId === databaseId) return "forward" as const;
  if (version.targetDatabaseId === databaseId) return "inverse" as const;
  return null;
}

export function RelationPropertyConfigurationDialog({
  open,
  ownerDatabaseId,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  ownerDatabaseId: string;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}) {
  const t = useT();
  const databases = useContentDatabases({ enabled: open });
  const types = useContentRelationshipTypes(
    open ? { databaseId: ownerDatabaseId, limit: 100 } : null,
  );
  const configure = useConfigureContentRelationProperty();
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [databaseQuery, setDatabaseQuery] = useState("");
  const [activeDatabaseIndex, setActiveDatabaseIndex] = useState(0);
  const [targetDatabaseId, setTargetDatabaseId] = useState("");
  const [forwardLabel, setForwardLabel] = useState("");
  const [inverseLabel, setInverseLabel] = useState("");
  const [forwardCardinality, setForwardCardinality] = useState<"one" | "many">(
    "many",
  );
  const [createInverse, setCreateInverse] = useState(false);
  const [inverseEditable, setInverseEditable] = useState(false);
  const [existingTypeId, setExistingTypeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  useRelationshipAppState(
    open
      ? {
          databaseId: ownerDatabaseId,
          typeId: existingTypeId || undefined,
          surface: "configuration",
        }
      : null,
  );

  useEffect(() => {
    if (!open) return;
    configure.clearFailedRequest();
    setError(null);
    const frame = requestAnimationFrame(() => firstInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    configure.clearFailedRequest();
    setError(null);
  }, [
    mode,
    targetDatabaseId,
    forwardLabel,
    inverseLabel,
    forwardCardinality,
    createInverse,
    inverseEditable,
    existingTypeId,
  ]);

  const filteredDatabases = useMemo(() => {
    const query = databaseQuery.trim().toLowerCase();
    return (databases.data?.databases ?? []).filter(
      (database) => !query || database.title.toLowerCase().includes(query),
    );
  }, [databaseQuery, databases.data?.databases]);
  const existingTypes = types.data?.items ?? [];
  const selectedExisting = existingTypes.find(
    (item) => item.type.id === existingTypeId,
  );
  const selectedExistingDirection = selectedExisting
    ? relationshipDirectionForDatabase(
        selectedExisting.version,
        ownerDatabaseId,
      )
    : null;
  const ownerDatabase = (databases.data?.databases ?? []).find(
    (database) => database.databaseId === ownerDatabaseId,
  );
  const targetDatabase = (databases.data?.databases ?? []).find(
    (database) => database.databaseId === targetDatabaseId,
  );

  async function submit() {
    setError(null);
    try {
      if (mode === "new") {
        const target = (databases.data?.databases ?? []).find(
          (database) => database.databaseId === targetDatabaseId,
        );
        if (!target || !forwardLabel.trim() || !inverseLabel.trim()) return;
        await configure.mutateAsync({
          ownerDatabaseId,
          alias: forwardLabel.trim(),
          definition: {
            kind: "new-local",
            forwardLabel: forwardLabel.trim(),
            inverseLabel: inverseLabel.trim(),
            forwardCardinality,
            sourceDatabaseId: ownerDatabaseId,
            targetDatabaseId,
          },
          inverseProjection: createInverse
            ? {
                ownerDatabaseId: targetDatabaseId,
                alias: inverseLabel.trim(),
                editable: inverseEditable,
              }
            : undefined,
          operationId: contentRelationshipOperationId(),
        });
      } else {
        if (!selectedExisting || !selectedExistingDirection) return;
        await configure.mutateAsync({
          ownerDatabaseId,
          alias:
            selectedExistingDirection === "forward"
              ? selectedExisting.version.forwardLabel
              : selectedExisting.version.inverseLabel,
          definition: {
            kind: "existing",
            relationshipTypeId: selectedExisting.type.id,
            direction: selectedExistingDirection,
          },
          operationId: contentRelationshipOperationId(),
        });
      }
      finishConfiguration();
    } catch (caught) {
      if (isSupersededRelationshipMutationError(caught)) return;
      setError(
        relationshipMutationErrorMessage(
          caught,
          t("relationships.requestInterrupted"),
          t("relationships.configurationFailed"),
        ),
      );
    }
  }

  function finishConfiguration() {
    onOpenChange(false);
    onCreated?.();
  }

  async function retrySubmit() {
    setError(null);
    try {
      await configure.retryFailed();
      finishConfiguration();
    } catch (caught) {
      if (isSupersededRelationshipMutationError(caught)) return;
      setError(
        relationshipMutationErrorMessage(
          caught,
          t("relationships.requestInterrupted"),
          t("relationships.configurationFailed"),
        ),
      );
    }
  }

  const newReady =
    !!targetDatabaseId && !!forwardLabel.trim() && !!inverseLabel.trim();
  const ready =
    mode === "new"
      ? newReady
      : !!selectedExisting &&
        !!selectedExistingDirection &&
        selectedExisting.capabilities.canConfigure;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(90vh,44rem)] w-[calc(100vw-1.5rem)] max-w-xl flex-col gap-0 overflow-hidden p-0 sm:w-full">
        <DialogHeader className="border-b px-5 py-4 text-start">
          <DialogTitle>{t("relationships.addRelation")}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <fieldset className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
            <legend className="sr-only">{t("relationships.definition")}</legend>
            {(["new", "existing"] as const).map((value) => (
              <label
                key={value}
                className={cn(
                  "flex h-8 cursor-pointer items-center justify-center rounded text-sm font-medium",
                  mode === value && "bg-background shadow-sm",
                )}
              >
                <input
                  type="radio"
                  name="relation-definition"
                  value={value}
                  checked={mode === value}
                  className="sr-only"
                  onChange={() => setMode(value)}
                />
                {t(
                  value === "new"
                    ? "relationships.newRelationship"
                    : "relationships.existingRelationship",
                )}
              </label>
            ))}
          </fieldset>

          {mode === "new" ? (
            <div className="mt-4 grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="relation-forward-label">
                  {t("relationships.forwardLabel")}
                </Label>
                <Input
                  ref={firstInputRef}
                  id="relation-forward-label"
                  value={forwardLabel}
                  placeholder={t("relationships.forwardLabelPlaceholder")}
                  onChange={(event) => setForwardLabel(event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="relation-inverse-label">
                  {t("relationships.inverseLabel")}
                </Label>
                <Input
                  id="relation-inverse-label"
                  value={inverseLabel}
                  placeholder={t("relationships.inverseLabelPlaceholder")}
                  onChange={(event) => setInverseLabel(event.target.value)}
                />
                <p className="text-sm text-muted-foreground">
                  {t("relationships.inverseLabelHelper", {
                    name:
                      inverseLabel.trim() ||
                      t("relationships.inverseLabelPlaceholder"),
                  })}
                </p>
              </div>
              <fieldset className="grid gap-2">
                <legend className="text-sm font-medium">
                  {t("relationships.cardinality")}
                </legend>
                <div className="grid grid-cols-2 gap-2">
                  {(["one", "many"] as const).map((value) => (
                    <label
                      key={value}
                      className={cn(
                        "flex min-h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm",
                        forwardCardinality === value &&
                          "border-foreground bg-muted/40",
                      )}
                    >
                      <input
                        type="radio"
                        name="relation-cardinality"
                        value={value}
                        checked={forwardCardinality === value}
                        onChange={() => setForwardCardinality(value)}
                      />
                      {t(
                        value === "one"
                          ? "relationships.onePage"
                          : "relationships.manyPages",
                      )}
                    </label>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground">
                  {t("relationships.emptyLinksHelper")}
                </p>
              </fieldset>
              <div className="grid gap-2">
                <Label htmlFor="relation-database-search">
                  {t("relationships.targetDatabase")}
                </Label>
                <div className="flex h-9 items-center gap-2 rounded-md border px-2">
                  <IconSearch className="size-4 shrink-0 text-muted-foreground" />
                  <Input
                    id="relation-database-search"
                    value={databaseQuery}
                    placeholder={t("relationships.searchDatabases")}
                    className="h-8 border-0 px-0 shadow-none focus-visible:ring-0"
                    onChange={(event) => {
                      setDatabaseQuery(event.target.value);
                      setActiveDatabaseIndex(0);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        setActiveDatabaseIndex((current) =>
                          Math.max(
                            0,
                            Math.min(filteredDatabases.length - 1, current + 1),
                          ),
                        );
                      } else if (event.key === "ArrowUp") {
                        event.preventDefault();
                        setActiveDatabaseIndex((current) =>
                          Math.max(0, current - 1),
                        );
                      } else if (event.key === "Enter") {
                        const database = filteredDatabases[activeDatabaseIndex];
                        if (database) {
                          event.preventDefault();
                          setTargetDatabaseId(database.databaseId);
                        }
                      }
                    }}
                  />
                </div>
                <div className="max-h-40 overflow-y-auto rounded-md border p-1">
                  {databases.isLoading ? (
                    <div className="grid gap-1 p-1">
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-4/5" />
                    </div>
                  ) : databases.isError ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void databases.refetch()}
                    >
                      {t("relationships.retryDatabases")}
                    </Button>
                  ) : filteredDatabases.length === 0 ? (
                    <div className="px-2 py-3 text-sm text-muted-foreground">
                      {t("relationships.noDatabases")}
                    </div>
                  ) : (
                    filteredDatabases.map((database, index) => (
                      <button
                        key={database.databaseId}
                        type="button"
                        className={cn(
                          "flex h-8 w-full items-center gap-2 rounded px-2 text-start text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          targetDatabaseId === database.databaseId &&
                            "bg-accent",
                          index === activeDatabaseIndex && "bg-accent/60",
                        )}
                        onMouseEnter={() => setActiveDatabaseIndex(index)}
                        onClick={() => setTargetDatabaseId(database.databaseId)}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {database.title}
                        </span>
                        {targetDatabaseId === database.databaseId ? (
                          <IconCheck className="size-4" />
                        ) : null}
                      </button>
                    ))
                  )}
                </div>
                {ownerDatabase && targetDatabase ? (
                  <p className="text-sm text-muted-foreground">
                    {t(
                      forwardCardinality === "one"
                        ? "relationships.linkContextOne"
                        : "relationships.linkContextMany",
                      {
                        source: ownerDatabase.title,
                        target: targetDatabase.title,
                      },
                    )}
                  </p>
                ) : null}
              </div>
              <div className="grid gap-3 border-t pt-4">
                <div className="flex items-center justify-between gap-3">
                  <Label
                    htmlFor="relation-create-inverse"
                    className="min-w-0 flex-1 break-words"
                    title={
                      targetDatabase
                        ? t("relationships.createInverseProperty", {
                            name: targetDatabase.title,
                          })
                        : undefined
                    }
                  >
                    {targetDatabase
                      ? t("relationships.createInverseProperty", {
                          name: targetDatabase.title,
                        })
                      : t("relationships.createInversePropertyUnselected")}
                  </Label>
                  <Switch
                    className="shrink-0"
                    id="relation-create-inverse"
                    checked={createInverse}
                    onCheckedChange={(checked) => {
                      setCreateInverse(checked);
                      if (!checked) setInverseEditable(false);
                    }}
                  />
                </div>
                {createInverse ? (
                  <div className="flex items-center justify-between gap-3 ps-3">
                    <Label htmlFor="relation-inverse-editable">
                      {t("relationships.inverseEditable")}
                    </Label>
                    <Switch
                      id="relation-inverse-editable"
                      checked={inverseEditable}
                      onCheckedChange={setInverseEditable}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="mt-4 grid gap-2">
              {types.isLoading ? (
                <div className="grid gap-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : types.isError ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void types.refetch()}
                >
                  {t("relationships.retryRelationships")}
                </Button>
              ) : existingTypes.length === 0 ? (
                <div className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                  {t("relationships.noExistingRelationships")}
                </div>
              ) : (
                existingTypes.map((item) => {
                  const direction = relationshipDirectionForDatabase(
                    item.version,
                    ownerDatabaseId,
                  );
                  return (
                    <button
                      key={item.type.id}
                      type="button"
                      disabled={!direction || !item.capabilities.canConfigure}
                      className={cn(
                        "flex min-h-10 w-full items-center gap-2 rounded-md border px-3 text-start text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                        existingTypeId === item.type.id && "border-foreground",
                      )}
                      onClick={() => setExistingTypeId(item.type.id)}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {item.version.forwardLabel}
                      </span>
                      <IconArrowRight className="size-4 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {item.version.inverseLabel}
                      </span>
                      {existingTypeId === item.type.id ? (
                        <IconCheck className="size-4" />
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
          )}

          {error ? (
            <div
              role="alert"
              className="mt-4 grid justify-items-start gap-1.5 text-sm text-destructive"
            >
              <span>{error}</span>
              {configure.failedVariables ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7"
                  disabled={configure.isPending}
                  onClick={() => void retrySubmit()}
                >
                  {t("relationships.retrySavedChange")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        <DialogFooter className="border-t px-5 py-3 sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            {t("relationships.cancel")}
          </Button>
          <Button
            type="button"
            disabled={!ready || configure.isPending}
            onClick={() => void submit()}
          >
            {configure.isPending
              ? t("relationships.adding")
              : t("relationships.addRelation")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
