import { useT } from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import { Checkbox } from "@agent-native/toolkit/ui/checkbox";
import { Label } from "@agent-native/toolkit/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import type {
  ContentDatabaseStatusRequirement,
  ContentDatabaseValidationConfig,
  DocumentProperty,
} from "@shared/api";
import {
  IconChevronDown,
  IconChevronRight,
  IconPlus,
  IconShieldCheck,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useManageContentDatabaseValidation } from "@/hooks/use-content-database";

const EMPTY_VALIDATION: ContentDatabaseValidationConfig = {
  requiredForSubmission: [],
  statusRequirements: [],
};

interface GateDraft {
  index: number | null;
  statusPropertyId: string;
  statusOptionId: string;
  requiredPropertyIds: string[];
}

function editableProperties(properties: DocumentProperty[]) {
  return properties.filter(
    (property) =>
      ![
        "formula",
        "rollup",
        "id",
        "created_time",
        "created_by",
        "last_edited_time",
        "last_edited_by",
      ].includes(property.definition.type),
  );
}

function toggleId(values: string[], id: string, checked: boolean) {
  return checked
    ? values.includes(id)
      ? values
      : [...values, id]
    : values.filter((value) => value !== id);
}

export function DatabaseValidationPanel({
  databaseId,
  properties,
  validation,
  canManage,
}: {
  databaseId: string;
  properties: DocumentProperty[];
  validation?: ContentDatabaseValidationConfig;
  canManage: boolean;
}) {
  const t = useT();
  const manageValidation = useManageContentDatabaseValidation(databaseId);
  const normalized = validation ?? EMPTY_VALIDATION;
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(normalized);
  const [dirty, setDirty] = useState(false);
  const [gateDraft, setGateDraft] = useState<GateDraft | null>(null);
  const availableProperties = useMemo(
    () => editableProperties(properties),
    [properties],
  );
  const statusProperties = useMemo(
    () =>
      availableProperties.filter(
        (property) => property.definition.type === "status",
      ),
    [availableProperties],
  );
  const propertyById = useMemo(
    () =>
      new Map(properties.map((property) => [property.definition.id, property])),
    [properties],
  );

  useEffect(() => {
    if (!dirty) setDraft(normalized);
  }, [dirty, validation]);

  const beginGate = (
    requirement?: ContentDatabaseStatusRequirement,
    index: number | null = null,
  ) => {
    const statusPropertyId =
      requirement?.statusPropertyId ?? statusProperties[0]?.definition.id ?? "";
    const statusProperty = propertyById.get(statusPropertyId);
    setGateDraft({
      index,
      statusPropertyId,
      statusOptionId:
        requirement?.statusOptionId ??
        statusProperty?.definition.options.options?.[0]?.id ??
        "",
      requiredPropertyIds: requirement?.requiredPropertyIds ?? [],
    });
  };

  const applyGateDraft = () => {
    if (
      !gateDraft?.statusPropertyId ||
      !gateDraft.statusOptionId ||
      gateDraft.requiredPropertyIds.length === 0
    ) {
      return;
    }
    const requirement: ContentDatabaseStatusRequirement = {
      statusPropertyId: gateDraft.statusPropertyId,
      statusOptionId: gateDraft.statusOptionId,
      requiredPropertyIds: gateDraft.requiredPropertyIds,
    };
    setDraft((current) => ({
      ...current,
      statusRequirements:
        gateDraft.index === null
          ? [...current.statusRequirements, requirement]
          : current.statusRequirements.map((existing, index) =>
              index === gateDraft.index ? requirement : existing,
            ),
    }));
    setDirty(true);
    setGateDraft(null);
  };

  const removeGate = (index: number) => {
    setDraft((current) => ({
      ...current,
      statusRequirements: current.statusRequirements.filter(
        (_, candidateIndex) => candidateIndex !== index,
      ),
    }));
    setDirty(true);
    setGateDraft(null);
  };

  const save = async () => {
    try {
      const result = await manageValidation.mutateAsync({
        databaseId,
        validation: draft,
      });
      setDraft(result.validation);
      setDirty(false);
      setGateDraft(null);
      toast.success(t("database.readinessSaved"));
    } catch (error) {
      toast.error(t("database.readinessSaveFailed"), {
        description:
          error instanceof Error ? error.message : t("empty.genericError"),
      });
    }
  };

  const summary =
    draft.requiredForSubmission.length || draft.statusRequirements.length
      ? [
          draft.requiredForSubmission.length
            ? t("database.submissionRequirementsConfigured")
            : null,
          draft.statusRequirements.length
            ? t("database.statusGatesConfigured")
            : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : t("database.noReadinessRequirements");

  return (
    <section className="border-b border-border pb-4">
      <button
        type="button"
        className="flex w-full items-center gap-3 rounded-md px-1 py-2 text-start hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <IconShieldCheck className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">
            {t("database.readiness")}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {summary}
          </span>
        </span>
        {expanded ? (
          <IconChevronDown className="size-4 text-muted-foreground" />
        ) : (
          <IconChevronRight className="size-4 text-muted-foreground" />
        )}
      </button>

      {expanded ? (
        <div className="grid gap-5 px-1 pt-3">
          <p className="text-xs leading-5 text-muted-foreground">
            {t("database.readinessDescription")}
          </p>

          <div className="grid gap-2">
            <div>
              <h4 className="text-xs font-medium">
                {t("database.submissionRequirements")}
              </h4>
              <p className="mt-1 text-xs leading-4 text-muted-foreground">
                {t("database.submissionRequirementsDescription")}
              </p>
            </div>
            <div className="grid gap-1">
              {availableProperties.map((property) => {
                const id = property.definition.id;
                const checked = draft.requiredForSubmission.includes(id);
                return (
                  <Label
                    key={id}
                    className="flex min-h-9 items-center gap-2 rounded-md px-2 font-normal hover:bg-muted/60"
                  >
                    <Checkbox
                      checked={checked}
                      disabled={!canManage}
                      onCheckedChange={(next) => {
                        setDraft((current) => ({
                          ...current,
                          requiredForSubmission: toggleId(
                            current.requiredForSubmission,
                            id,
                            next === true,
                          ),
                        }));
                        setDirty(true);
                      }}
                    />
                    <span className="truncate text-sm">
                      {property.definition.name}
                    </span>
                  </Label>
                );
              })}
            </div>
          </div>

          <div className="grid gap-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h4 className="text-xs font-medium">
                  {t("database.statusGates")}
                </h4>
                <p className="mt-1 text-xs leading-4 text-muted-foreground">
                  {t("database.statusGatesDescription")}
                </p>
              </div>
              {canManage && !gateDraft && statusProperties.length ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0"
                  onClick={() => beginGate()}
                >
                  <IconPlus className="size-4" />
                  {t("database.addStatusGate")}
                </Button>
              ) : null}
            </div>

            {draft.statusRequirements.length ? (
              <div className="grid gap-1">
                {draft.statusRequirements.map((requirement, index) => {
                  const statusProperty = propertyById.get(
                    requirement.statusPropertyId,
                  );
                  const option =
                    statusProperty?.definition.options.options?.find(
                      (candidate) =>
                        candidate.id === requirement.statusOptionId,
                    );
                  const requiredNames = requirement.requiredPropertyIds
                    .map(
                      (propertyId) =>
                        propertyById.get(propertyId)?.definition.name ??
                        propertyId,
                    )
                    .join(", ");
                  return (
                    <button
                      key={`${requirement.statusPropertyId}:${requirement.statusOptionId}`}
                      type="button"
                      disabled={!canManage}
                      className="rounded-md px-2 py-2 text-start hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent"
                      onClick={() => beginGate(requirement, index)}
                    >
                      <span className="block truncate text-sm font-medium">
                        {statusProperty?.definition.name ??
                          requirement.statusPropertyId}{" "}
                        {"→"} {option?.name ?? requirement.statusOptionId}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {requiredNames}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : !gateDraft ? (
              <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                {t("database.noStatusGates")}
              </p>
            ) : null}

            {gateDraft ? (
              <div className="grid gap-3 rounded-md border border-border p-3">
                <div className="grid gap-2">
                  <Label>{t("database.statusProperty")}</Label>
                  <Select
                    value={gateDraft.statusPropertyId}
                    onValueChange={(statusPropertyId) => {
                      const statusProperty = propertyById.get(statusPropertyId);
                      setGateDraft((current) =>
                        current
                          ? {
                              ...current,
                              statusPropertyId,
                              statusOptionId:
                                statusProperty?.definition.options.options?.[0]
                                  ?.id ?? "",
                              requiredPropertyIds:
                                current.requiredPropertyIds.filter(
                                  (id) => id !== statusPropertyId,
                                ),
                            }
                          : current,
                      );
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={t("database.chooseStatusProperty")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {statusProperties.map((property) => (
                          <SelectItem
                            key={property.definition.id}
                            value={property.definition.id}
                          >
                            {property.definition.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label>{t("database.statusOption")}</Label>
                  <Select
                    value={gateDraft.statusOptionId}
                    onValueChange={(statusOptionId) =>
                      setGateDraft((current) =>
                        current ? { ...current, statusOptionId } : current,
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={t("database.chooseStatusOption")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {(
                          propertyById.get(gateDraft.statusPropertyId)
                            ?.definition.options.options ?? []
                        ).map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-1">
                  <Label className="mb-1">
                    {t("database.requiredEvidence")}
                  </Label>
                  {availableProperties
                    .filter(
                      (property) =>
                        property.definition.id !== gateDraft.statusPropertyId,
                    )
                    .map((property) => {
                      const id = property.definition.id;
                      return (
                        <Label
                          key={id}
                          className="flex min-h-8 items-center gap-2 rounded-md px-1 font-normal"
                        >
                          <Checkbox
                            checked={gateDraft.requiredPropertyIds.includes(id)}
                            onCheckedChange={(next) =>
                              setGateDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      requiredPropertyIds: toggleId(
                                        current.requiredPropertyIds,
                                        id,
                                        next === true,
                                      ),
                                    }
                                  : current,
                              )
                            }
                          />
                          <span className="truncate text-sm">
                            {property.definition.name}
                          </span>
                        </Label>
                      );
                    })}
                </div>

                <div className="flex items-center justify-between gap-2">
                  {gateDraft.index !== null ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => removeGate(gateDraft.index!)}
                    >
                      <IconTrash className="size-4" />
                      {t("database.removeGate")}
                    </Button>
                  ) : (
                    <span />
                  )}
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setGateDraft(null)}
                    >
                      {t("database.cancel")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={
                        !gateDraft.statusPropertyId ||
                        !gateDraft.statusOptionId ||
                        gateDraft.requiredPropertyIds.length === 0
                      }
                      onClick={applyGateDraft}
                    >
                      {t("database.applyGate")}
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {canManage ? (
            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                disabled={!dirty || manageValidation.isPending}
                onClick={save}
              >
                {manageValidation.isPending ? (
                  <Spinner className="size-4" />
                ) : null}
                {t("database.saveReadiness")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
