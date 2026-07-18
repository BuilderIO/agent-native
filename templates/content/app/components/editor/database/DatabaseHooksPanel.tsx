import {
  getBrowserTabId,
  setClientAppState,
  useT,
} from "@agent-native/core/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@agent-native/toolkit/ui/alert-dialog";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@agent-native/toolkit/ui/dialog";
import { Input } from "@agent-native/toolkit/ui/input";
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
import { Switch } from "@agent-native/toolkit/ui/switch";
import type {
  ContentDatabaseHook,
  ContentDatabaseHookCondition,
  ContentDatabaseHookConditions,
  ContentDatabaseHookEffect,
  ContentDatabaseHookExecutionStatus,
  ContentDatabaseHookTiming,
  ContentDatabaseHookTrigger,
  ContentDatabaseHookTriggerAvailability,
  DocumentProperty,
} from "@shared/api";
import {
  IconBell,
  IconChevronDown,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  useContentDatabaseHookExecutions,
  useContentDatabaseHooks,
  useManageContentDatabaseHook,
  useManageContentDatabasePolicy,
} from "@/hooks/use-content-database";

import { DatabaseHookIncidentControls } from "./DatabaseHookIncidentControls";

type TriggerKind = ContentDatabaseHookTrigger["kind"];

interface HookDraft {
  hookId?: string;
  name: string;
  enabled: boolean;
  triggerKind: TriggerKind;
  propertyId: string;
  fromOptionId: string;
  toOptionId: string;
  publicationAction: string;
  conditions?: ContentDatabaseHookConditions;
  timing: ContentDatabaseHookTiming;
  effects: ContentDatabaseHookEffect[];
}

const EMPTY_OPTION = "__any__";

function assertNever(value: never): never {
  throw new Error(`Unsupported Content Rule value: ${JSON.stringify(value)}`);
}

function deterministicEffectProperties(properties: DocumentProperty[]) {
  return properties.filter(
    (property) =>
      ![
        "blocks",
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

function executionStatusKey(status: ContentDatabaseHookExecutionStatus) {
  if (status === "pending") return "database.executionPending" as const;
  if (status === "running") return "database.executionRunning" as const;
  if (status === "succeeded") return "database.executionSucceeded" as const;
  if (status === "failed") return "database.executionFailed" as const;
  if (status === "retrying") return "database.executionRetrying" as const;
  if (status === "acknowledged")
    return "database.executionAcknowledged" as const;
  return "database.executionUnknown" as const;
}

function triggerSummaryKey(trigger: ContentDatabaseHookTrigger) {
  switch (trigger.kind) {
    case "item_submitted":
      return "database.whenItemSubmitted" as const;
    case "item_created":
      return "database.whenItemCreated" as const;
    case "property_changed":
      return "database.whenPropertyChanges" as const;
    case "builder_publication_confirmed":
      return "database.whenBuilderPublicationConfirmed" as const;
    default:
      return assertNever(trigger);
  }
}

function emptyDraft(
  properties: DocumentProperty[],
  availability: ContentDatabaseHookTriggerAvailability[],
): HookDraft {
  const personProperties = properties.filter(
    (property) => property.definition.type === "person",
  );
  const triggerKind =
    availability.find(
      (candidate) => candidate.kind === "item_submitted" && candidate.available,
    )?.kind ??
    availability.find((candidate) => candidate.available)?.kind ??
    "item_submitted";
  return {
    name: "",
    enabled: true,
    triggerKind,
    propertyId: "",
    fromOptionId: EMPTY_OPTION,
    toOptionId: EMPTY_OPTION,
    publicationAction: EMPTY_OPTION,
    conditions: undefined,
    timing: { kind: "immediate" },
    effects: [
      {
        version: 1,
        kind: "notify",
        recipientPersonPropertyId: personProperties[0]?.definition.id ?? "",
      },
    ],
  };
}

function hookDraft(hook: ContentDatabaseHook): HookDraft {
  return {
    hookId: hook.id,
    name: hook.name,
    enabled: hook.enabled,
    triggerKind: hook.trigger.kind,
    propertyId:
      hook.trigger.kind === "property_changed" ? hook.trigger.propertyId : "",
    fromOptionId:
      hook.trigger.kind === "property_changed" && hook.trigger.fromOptionId
        ? hook.trigger.fromOptionId
        : EMPTY_OPTION,
    toOptionId:
      hook.trigger.kind === "property_changed" && hook.trigger.toOptionId
        ? hook.trigger.toOptionId
        : EMPTY_OPTION,
    publicationAction:
      hook.trigger.kind === "builder_publication_confirmed" &&
      hook.trigger.publicationAction
        ? hook.trigger.publicationAction
        : EMPTY_OPTION,
    conditions: hook.conditions,
    timing: hook.timing,
    effects: hook.effects,
  };
}

function emptyEffect(
  kind: ContentDatabaseHookEffect["kind"],
  properties: DocumentProperty[],
): ContentDatabaseHookEffect {
  switch (kind) {
    case "notify":
      return {
        version: 1,
        kind,
        recipientPersonPropertyId:
          properties.find((property) => property.definition.type === "person")
            ?.definition.id ?? "",
      };
    case "team_slack":
      return { version: 1, kind, webhookKey: "" };
    case "webhook":
      return { version: 1, kind, urlKey: "", signatureKey: "" };
    case "set_property":
      return {
        version: 1,
        kind,
        propertyId:
          deterministicEffectProperties(properties)[0]?.definition.id ?? "",
        value: null,
      };
    default:
      return assertNever(kind);
  }
}

function validEffect(effect: ContentDatabaseHookEffect) {
  switch (effect.kind) {
    case "notify":
      return !!effect.recipientPersonPropertyId;
    case "team_slack":
      return !!effect.webhookKey.trim();
    case "webhook":
      return !!effect.urlKey.trim() && !!effect.signatureKey.trim();
    case "set_property":
      return !!effect.propertyId;
    default:
      return assertNever(effect);
  }
}

function emptyCondition(
  properties: DocumentProperty[],
): ContentDatabaseHookCondition {
  return {
    propertyId:
      deterministicEffectProperties(properties)[0]?.definition.id ?? "",
    operator: "is_not_empty",
  };
}

function validConditions(conditions?: ContentDatabaseHookConditions) {
  return (
    !conditions ||
    (conditions.clauses.length > 0 &&
      conditions.clauses.every((condition) => !!condition.propertyId))
  );
}

export function DatabaseHooksPanel({
  databaseId,
  properties,
  canManage,
  isOwner,
  defaultPersonNotificationsEnabled,
}: {
  databaseId: string;
  properties: DocumentProperty[];
  canManage: boolean;
  isOwner: boolean;
  defaultPersonNotificationsEnabled: boolean;
}) {
  const t = useT();
  const hooksQuery = useContentDatabaseHooks(databaseId);
  const executionsQuery = useContentDatabaseHookExecutions(databaseId);
  const manageHook = useManageContentDatabaseHook(databaseId);
  const managePolicy = useManageContentDatabasePolicy();
  const personProperties = useMemo(
    () =>
      properties.filter((property) => property.definition.type === "person"),
    [properties],
  );
  const [draft, setDraft] = useState<HookDraft | null>(null);
  const [defaultNotificationsEnabled, setDefaultNotificationsEnabled] =
    useState(defaultPersonNotificationsEnabled);
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [showPreviousValue, setShowPreviousValue] = useState(false);
  const selectedProperty = properties.find(
    (property) => property.definition.id === draft?.propertyId,
  );
  const stableOptions = selectedProperty?.definition.options.options ?? [];
  const hooks = hooksQuery.data?.hooks ?? [];
  const executions = executionsQuery.data?.executions ?? [];
  const hasExecutionIncident = executions.some(
    (execution) =>
      execution.status === "failed" || execution.status === "retrying",
  );
  const triggerAvailability = hooksQuery.data?.triggerAvailability ?? [];
  const availabilityFor = (kind: TriggerKind) =>
    triggerAvailability.find((candidate) => candidate.kind === kind);
  const draftTriggerAvailability = draft
    ? availabilityFor(draft.triggerKind)
    : undefined;

  useEffect(() => {
    setDefaultNotificationsEnabled(defaultPersonNotificationsEnabled);
  }, [defaultPersonNotificationsEnabled]);

  useEffect(() => {
    const key = `content-hook-context:${getBrowserTabId()}`;
    void setClientAppState(
      key,
      {
        databaseId,
        view: draft ? (draft.hookId ? "edit" : "create") : "list",
        hookId: draft?.hookId,
      },
      { requestSource: "frontend" },
    ).catch(() => {});
    return () => {
      void setClientAppState(key, null, {
        keepalive: true,
        requestSource: "frontend",
      }).catch(() => {});
    };
  }, [databaseId, draft?.hookId, Boolean(draft)]);

  const startCreate = () => {
    setDraft(emptyDraft(properties, triggerAvailability));
    setShowPreviousValue(false);
  };

  const startEdit = (hook: ContentDatabaseHook) => {
    const next = hookDraft(hook);
    setDraft(next);
    setShowPreviousValue(next.fromOptionId !== EMPTY_OPTION);
  };

  const saveDraft = async () => {
    if (
      !draft ||
      !draft.name.trim() ||
      !draft.effects.length ||
      !draft.effects.every(validEffect) ||
      !validConditions(draft.conditions)
    )
      return;
    if (availabilityFor(draft.triggerKind)?.available !== true) return;
    if (draft.triggerKind === "property_changed" && !draft.propertyId) return;

    let trigger: ContentDatabaseHookTrigger;
    switch (draft.triggerKind) {
      case "item_submitted":
        trigger = { kind: "item_submitted" };
        break;
      case "item_created":
        trigger = { kind: "item_created" };
        break;
      case "builder_publication_confirmed":
        trigger = {
          kind: "builder_publication_confirmed",
          publicationAction:
            draft.publicationAction === EMPTY_OPTION
              ? null
              : (draft.publicationAction as "publish" | "unpublish"),
        };
        break;
      case "property_changed":
        trigger = {
          kind: "property_changed",
          propertyId: draft.propertyId,
          fromOptionId:
            showPreviousValue && draft.fromOptionId !== EMPTY_OPTION
              ? draft.fromOptionId
              : null,
          toOptionId:
            draft.toOptionId === EMPTY_OPTION ? null : draft.toOptionId,
        };
        break;
    }
    try {
      await manageHook.mutateAsync(
        draft.hookId
          ? {
              action: "update",
              databaseId,
              hookId: draft.hookId,
              name: draft.name.trim(),
              enabled: draft.enabled,
              trigger,
              conditions: draft.conditions ?? null,
              effects: draft.effects,
              timing: draft.timing,
            }
          : {
              action: "create",
              databaseId,
              name: draft.name.trim(),
              enabled: draft.enabled,
              trigger,
              conditions: draft.conditions,
              effects: draft.effects,
              timing: draft.timing,
            },
      );
      toast.success(
        t(
          draft.hookId
            ? "database.notificationRuleUpdated"
            : "database.notificationRuleCreated",
        ),
      );
      setDraft(null);
    } catch (error) {
      toast.error(t("database.notificationRuleSaveFailed"), {
        description:
          error instanceof Error ? error.message : t("empty.genericError"),
      });
    }
  };

  const deleteHook = async (hookId: string) => {
    try {
      await manageHook.mutateAsync({ action: "delete", databaseId, hookId });
      toast.success(t("database.notificationRuleDeleted"));
      setDeleteConfirmationOpen(false);
      setDraft(null);
    } catch (error) {
      toast.error(t("database.notificationRuleDeleteFailed"), {
        description:
          error instanceof Error ? error.message : t("empty.genericError"),
      });
    }
  };

  const setDefaultPersonNotifications = (enabled: boolean) => {
    setDefaultNotificationsEnabled(enabled);
    managePolicy.mutate(
      { databaseId, defaultPersonNotificationsEnabled: enabled },
      {
        onSuccess: () =>
          toast.success(
            t(
              enabled
                ? "database.defaultPersonNotificationsEnabled"
                : "database.defaultPersonNotificationsDisabled",
            ),
          ),
        onError: (error) => {
          setDefaultNotificationsEnabled(!enabled);
          toast.error(t("database.defaultPersonNotificationsFailed"), {
            description:
              error instanceof Error ? error.message : t("empty.genericError"),
          });
        },
      },
    );
  };

  const setHookEnabled = async (
    hook: ContentDatabaseHook,
    enabled: boolean,
  ) => {
    try {
      await manageHook.mutateAsync({
        action: "update",
        databaseId,
        hookId: hook.id,
        name: hook.name,
        enabled,
        trigger: hook.trigger,
        conditions: hook.conditions,
        effects: hook.effects,
        timing: hook.timing,
      });
      toast.success(t("database.notificationRuleUpdated"));
    } catch (error) {
      toast.error(t("database.notificationRuleSaveFailed"), {
        description:
          error instanceof Error ? error.message : t("empty.genericError"),
      });
    }
  };

  if (hooksQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Spinner className="size-4 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <DatabaseHookIncidentControls
        databaseId={databaseId}
        canManage={isOwner}
        hasExecutionIncident={hasExecutionIncident}
      />
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs leading-5 text-muted-foreground">
          {t("database.notificationRulesDescription")}
        </p>
        {canManage ? (
          <Button size="sm" className="h-8 shrink-0" onClick={startCreate}>
            <IconPlus className="size-4" />
            {t("database.addNotificationRule")}
          </Button>
        ) : null}
      </div>

      {personProperties.length || hooks.length ? (
        <div className="grid gap-1">
          {personProperties.length ? (
            <div className="flex min-h-12 items-center gap-2 rounded-md px-2 hover:bg-muted">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <IconBell className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {t("database.defaultPersonNotifications")}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {t("database.defaultPersonNotificationsDescription")}
                </span>
              </span>
              <span className="text-xs text-muted-foreground">
                {t(
                  defaultNotificationsEnabled
                    ? "database.ruleEnabled"
                    : "database.rulePaused",
                )}
              </span>
              {isOwner ? (
                <Switch
                  aria-label={t("database.defaultPersonNotifications")}
                  checked={defaultNotificationsEnabled}
                  disabled={managePolicy.isPending}
                  onCheckedChange={setDefaultPersonNotifications}
                />
              ) : null}
            </div>
          ) : null}
          {hooks.map((hook) => (
            <div
              key={hook.id}
              className="flex min-h-12 items-center gap-2 rounded-md px-2 hover:bg-muted"
            >
              <button
                type="button"
                disabled={!canManage}
                className="flex min-w-0 flex-1 items-center gap-3 text-start disabled:cursor-default"
                onClick={() => startEdit(hook)}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <IconBell className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {hook.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {t(triggerSummaryKey(hook.trigger))}
                  </span>
                </span>
              </button>
              <span className="text-xs text-muted-foreground">
                {t(
                  hook.enabled ? "database.ruleEnabled" : "database.rulePaused",
                )}
              </span>
              {canManage ? (
                <Switch
                  aria-label={hook.name}
                  checked={hook.enabled}
                  disabled={manageHook.isPending}
                  onCheckedChange={(enabled) =>
                    void setHookEnabled(hook, enabled)
                  }
                />
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
          {t("database.noNotificationRules")}
        </div>
      )}

      <Dialog
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open) setDraft(null);
        }}
      >
        <DialogContent className="max-h-[min(88vh,760px)] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {draft?.hookId ? draft.name : t("database.addNotificationRule")}
            </DialogTitle>
            <DialogDescription>
              {t("database.notificationRulesDescription")}
            </DialogDescription>
          </DialogHeader>
          {draft ? (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="hook-name">{t("database.ruleName")}</Label>
                <Input
                  id="hook-name"
                  value={draft.name}
                  autoFocus
                  placeholder={t("database.ruleNamePlaceholder")}
                  onChange={(event) =>
                    setDraft((current) =>
                      current
                        ? { ...current, name: event.target.value }
                        : current,
                    )
                  }
                />
              </div>

              <div className="grid gap-2">
                <Label>{t("database.when")}</Label>
                <Select
                  value={draft.triggerKind}
                  onValueChange={(value: TriggerKind) =>
                    setDraft((current) =>
                      current ? { ...current, triggerKind: value } : current,
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem
                        value="item_submitted"
                        disabled={
                          availabilityFor("item_submitted")?.available !== true
                        }
                      >
                        {t("database.anItemIsSubmitted")}
                      </SelectItem>
                      <SelectItem
                        value="item_created"
                        disabled={
                          availabilityFor("item_created")?.available !== true
                        }
                      >
                        {t("database.itemCreatedUnavailable")}
                      </SelectItem>
                      <SelectItem
                        value="property_changed"
                        disabled={
                          availabilityFor("property_changed")?.available !==
                          true
                        }
                      >
                        {t("database.aPropertyChanges")}
                      </SelectItem>
                      <SelectItem
                        value="builder_publication_confirmed"
                        disabled={
                          availabilityFor("builder_publication_confirmed")
                            ?.available !== true
                        }
                      >
                        {t("database.builderPublicationIsConfirmed")}
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {draftTriggerAvailability?.available === false &&
                draftTriggerAvailability.reason ? (
                  <p className="text-xs leading-4 text-destructive">
                    {draftTriggerAvailability.reason}
                  </p>
                ) : null}
              </div>

              {draft.triggerKind === "property_changed" ? (
                <div className="grid gap-3 border-s border-border ps-3">
                  <div className="grid gap-2">
                    <Label>{t("database.property")}</Label>
                    <Select
                      value={draft.propertyId}
                      onValueChange={(propertyId) =>
                        setDraft((current) =>
                          current
                            ? {
                                ...current,
                                propertyId,
                                fromOptionId: EMPTY_OPTION,
                                toOptionId: EMPTY_OPTION,
                              }
                            : current,
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue
                          placeholder={t("database.chooseAProperty")}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {properties.map((property) => (
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

                  {stableOptions.length ? (
                    <>
                      <div className="grid gap-2">
                        <Label>{t("database.resultingOption")}</Label>
                        <Select
                          value={draft.toOptionId}
                          onValueChange={(toOptionId) =>
                            setDraft((current) =>
                              current ? { ...current, toOptionId } : current,
                            )
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value={EMPTY_OPTION}>
                                {t("database.anyOption")}
                              </SelectItem>
                              {stableOptions.map((option) => (
                                <SelectItem key={option.id} value={option.id}>
                                  {option.name}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </div>
                      <button
                        type="button"
                        className="flex items-center gap-1 text-start text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => setShowPreviousValue((value) => !value)}
                      >
                        <IconChevronDown
                          className={`size-3.5 transition-transform duration-150 ${showPreviousValue ? "rotate-180" : ""}`}
                        />
                        {t("database.previousOptionCondition")}
                      </button>
                      {showPreviousValue ? (
                        <div className="grid gap-2">
                          <Label>{t("database.previousOption")}</Label>
                          <Select
                            value={draft.fromOptionId}
                            onValueChange={(fromOptionId) =>
                              setDraft((current) =>
                                current
                                  ? { ...current, fromOptionId }
                                  : current,
                              )
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                <SelectItem value={EMPTY_OPTION}>
                                  {t("database.anyOption")}
                                </SelectItem>
                                {stableOptions.map((option) => (
                                  <SelectItem key={option.id} value={option.id}>
                                    {option.name}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : null}

              {draft.triggerKind === "builder_publication_confirmed" ? (
                <div className="grid gap-2 border-s border-border ps-3">
                  <Label>{t("database.publicationAction")}</Label>
                  <Select
                    value={draft.publicationAction}
                    onValueChange={(publicationAction) =>
                      setDraft((current) =>
                        current ? { ...current, publicationAction } : current,
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value={EMPTY_OPTION}>
                          {t("database.publishOrUnpublish")}
                        </SelectItem>
                        <SelectItem value="publish">
                          {t("database.publishConfirmed")}
                        </SelectItem>
                        <SelectItem value="unpublish">
                          {t("database.unpublishConfirmed")}
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <p className="text-xs leading-4 text-muted-foreground">
                    {t("database.builderConfirmationDescription")}
                  </p>
                </div>
              ) : null}

              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-2">
                  <Label>{t("database.if")}</Label>
                  {!draft.conditions ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setDraft((current) =>
                          current
                            ? {
                                ...current,
                                conditions: {
                                  mode: "all",
                                  clauses: [emptyCondition(properties)],
                                },
                              }
                            : current,
                        )
                      }
                    >
                      <IconPlus className="size-4" />
                      {t("database.addConditions")}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setDraft((current) =>
                          current
                            ? { ...current, conditions: undefined }
                            : current,
                        )
                      }
                    >
                      {t("database.removeConditions")}
                    </Button>
                  )}
                </div>
                {draft.conditions ? (
                  <div className="grid gap-3 border-s border-border ps-3">
                    <Select
                      value={draft.conditions.mode}
                      onValueChange={(
                        mode: ContentDatabaseHookConditions["mode"],
                      ) =>
                        setDraft((current) =>
                          current?.conditions
                            ? {
                                ...current,
                                conditions: { ...current.conditions, mode },
                              }
                            : current,
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="all">
                            {t("database.matchAllConditions")}
                          </SelectItem>
                          <SelectItem value="any">
                            {t("database.matchAnyCondition")}
                          </SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    {draft.conditions.clauses.map((condition, index) => (
                      <div
                        key={`${condition.propertyId}:${index}`}
                        className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_1fr_auto]"
                      >
                        <Select
                          value={condition.propertyId}
                          onValueChange={(propertyId) =>
                            setDraft((current) =>
                              current?.conditions
                                ? {
                                    ...current,
                                    conditions: {
                                      ...current.conditions,
                                      clauses: current.conditions.clauses.map(
                                        (candidate, at) =>
                                          at === index
                                            ? { ...candidate, propertyId }
                                            : candidate,
                                      ),
                                    },
                                  }
                                : current,
                            )
                          }
                        >
                          <SelectTrigger>
                            <SelectValue
                              placeholder={t("database.chooseAProperty")}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {deterministicEffectProperties(properties).map(
                                (property) => (
                                  <SelectItem
                                    key={property.definition.id}
                                    value={property.definition.id}
                                  >
                                    {property.definition.name}
                                  </SelectItem>
                                ),
                              )}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        <Select
                          value={condition.operator}
                          onValueChange={(
                            operator: ContentDatabaseHookCondition["operator"],
                          ) =>
                            setDraft((current) =>
                              current?.conditions
                                ? {
                                    ...current,
                                    conditions: {
                                      ...current.conditions,
                                      clauses: current.conditions.clauses.map(
                                        (candidate, at) =>
                                          at !== index
                                            ? candidate
                                            : operator === "is_empty" ||
                                                operator === "is_not_empty"
                                              ? {
                                                  propertyId:
                                                    candidate.propertyId,
                                                  operator,
                                                }
                                              : {
                                                  propertyId:
                                                    candidate.propertyId,
                                                  operator,
                                                  value: "",
                                                },
                                      ),
                                    },
                                  }
                                : current,
                            )
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="equals">
                                {t("database.operatorEquals")}
                              </SelectItem>
                              <SelectItem value="not_equals">
                                {t("database.operatorNotEquals")}
                              </SelectItem>
                              <SelectItem value="contains">
                                {t("database.operatorContains")}
                              </SelectItem>
                              <SelectItem value="is_empty">
                                {t("database.operatorIsEmpty")}
                              </SelectItem>
                              <SelectItem value="is_not_empty">
                                {t("database.operatorIsNotEmpty")}
                              </SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label={t("database.removeCondition")}
                          onClick={() =>
                            setDraft((current) =>
                              current?.conditions
                                ? current.conditions.clauses.length === 1
                                  ? { ...current, conditions: undefined }
                                  : {
                                      ...current,
                                      conditions: {
                                        ...current.conditions,
                                        clauses:
                                          current.conditions.clauses.filter(
                                            (_, at) => at !== index,
                                          ),
                                      },
                                    }
                                : current,
                            )
                          }
                        >
                          <IconTrash className="size-4" />
                        </Button>
                        {"value" in condition ? (
                          <Input
                            className="sm:col-span-2"
                            value={
                              typeof condition.value === "string"
                                ? condition.value
                                : JSON.stringify(condition.value)
                            }
                            placeholder={t(
                              "database.conditionValuePlaceholder",
                            )}
                            onChange={(event) => {
                              const raw = event.target.value;
                              let value: unknown = raw;
                              try {
                                value = JSON.parse(raw);
                              } catch {
                                value = raw;
                              }
                              setDraft((current) =>
                                current?.conditions
                                  ? {
                                      ...current,
                                      conditions: {
                                        ...current.conditions,
                                        clauses: current.conditions.clauses.map(
                                          (candidate, at) =>
                                            at === index && "value" in candidate
                                              ? { ...candidate, value }
                                              : candidate,
                                        ),
                                      },
                                    }
                                  : current,
                              );
                            }}
                          />
                        ) : null}
                      </div>
                    ))}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={draft.conditions.clauses.length >= 10}
                      onClick={() =>
                        setDraft((current) =>
                          current?.conditions
                            ? {
                                ...current,
                                conditions: {
                                  ...current.conditions,
                                  clauses: [
                                    ...current.conditions.clauses,
                                    emptyCondition(properties),
                                  ],
                                },
                              }
                            : current,
                        )
                      }
                    >
                      <IconPlus className="size-4" />
                      {t("database.addCondition")}
                    </Button>
                  </div>
                ) : null}
              </div>

              <details className="group rounded-md border border-border px-3 py-2">
                <summary className="cursor-pointer list-none text-sm font-medium text-muted-foreground hover:text-foreground">
                  {t("database.hookTiming")}
                </summary>
                <div className="mt-3 grid gap-2">
                  <Select
                    value={draft.timing.kind}
                    onValueChange={(kind: ContentDatabaseHookTiming["kind"]) =>
                      setDraft((current) =>
                        current
                          ? {
                              ...current,
                              timing:
                                kind === "immediate"
                                  ? { kind }
                                  : { kind, delayMinutes: 5 },
                            }
                          : current,
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="immediate">
                          {t("database.timingImmediate")}
                        </SelectItem>
                        <SelectItem value="delayed">
                          {t("database.timingDelayed")}
                        </SelectItem>
                        <SelectItem value="debounced">
                          {t("database.timingDebounced")}
                        </SelectItem>
                        <SelectItem value="escalation">
                          {t("database.timingEscalation")}
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {draft.timing.kind !== "immediate" ? (
                    <div className="grid gap-2 border-s border-border ps-3">
                      <Label htmlFor="hook-delay-minutes">
                        {t("database.delayMinutes")}
                      </Label>
                      <Input
                        id="hook-delay-minutes"
                        type="number"
                        min={1}
                        max={10080}
                        value={draft.timing.delayMinutes}
                        onChange={(event) => {
                          const delayMinutes = Math.min(
                            Math.max(Number(event.target.value) || 1, 1),
                            10080,
                          );
                          setDraft((current) =>
                            current && current.timing.kind !== "immediate"
                              ? {
                                  ...current,
                                  timing: { ...current.timing, delayMinutes },
                                }
                              : current,
                          );
                        }}
                      />
                      <p className="text-xs leading-4 text-muted-foreground">
                        {t(
                          draft.timing.kind === "delayed"
                            ? "database.timingDelayedDescription"
                            : draft.timing.kind === "debounced"
                              ? "database.timingDebouncedDescription"
                              : "database.timingEscalationDescription",
                        )}
                      </p>
                    </div>
                  ) : null}
                </div>
              </details>

              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-2">
                  <Label>{t("database.effects")}</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={draft.effects.length >= 10}
                    onClick={() =>
                      setDraft((current) =>
                        current
                          ? {
                              ...current,
                              effects: [
                                ...current.effects,
                                emptyEffect("notify", properties),
                              ],
                            }
                          : current,
                      )
                    }
                  >
                    <IconPlus className="size-4" />
                    {t("database.addEffect")}
                  </Button>
                </div>
                {draft.effects.map((effect, index) => (
                  <div
                    key={`${effect.kind}:${index}`}
                    className="grid gap-3 rounded-md border border-border p-3"
                  >
                    <div className="flex items-center gap-2">
                      <Select
                        value={effect.kind}
                        onValueChange={(
                          kind: ContentDatabaseHookEffect["kind"],
                        ) =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  effects: current.effects.map(
                                    (candidate, at) =>
                                      at === index
                                        ? emptyEffect(kind, properties)
                                        : candidate,
                                  ),
                                }
                              : current,
                          )
                        }
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="notify">
                              {t("database.personalNotification")}
                            </SelectItem>
                            <SelectItem value="team_slack">
                              {t("database.teamSlackAnnouncement")}
                            </SelectItem>
                            <SelectItem value="webhook">
                              {t("database.signedWebhook")}
                            </SelectItem>
                            <SelectItem value="set_property">
                              {t("database.setPropertyEffect")}
                            </SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      {draft.effects.length > 1 ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label={t("database.removeEffect")}
                          onClick={() =>
                            setDraft((current) =>
                              current
                                ? {
                                    ...current,
                                    effects: current.effects.filter(
                                      (_, at) => at !== index,
                                    ),
                                  }
                                : current,
                            )
                          }
                        >
                          <IconTrash className="size-4" />
                        </Button>
                      ) : null}
                    </div>

                    {effect.kind === "notify" ? (
                      <div className="grid gap-2">
                        <Label>{t("database.notifyPeopleIn")}</Label>
                        <Select
                          value={effect.recipientPersonPropertyId}
                          onValueChange={(recipientPersonPropertyId) =>
                            setDraft((current) =>
                              current
                                ? {
                                    ...current,
                                    effects: current.effects.map(
                                      (candidate, at) =>
                                        at === index &&
                                        candidate.kind === "notify"
                                          ? {
                                              ...candidate,
                                              recipientPersonPropertyId,
                                            }
                                          : candidate,
                                    ),
                                  }
                                : current,
                            )
                          }
                        >
                          <SelectTrigger>
                            <SelectValue
                              placeholder={t("database.choosePersonProperty")}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {personProperties.map((property) => (
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
                        {!personProperties.length ? (
                          <p className="text-xs text-muted-foreground">
                            {t("database.personPropertyRequired")}
                          </p>
                        ) : null}
                      </div>
                    ) : effect.kind === "team_slack" ? (
                      <div className="grid gap-2">
                        <Label>{t("database.slackWebhookSecretKey")}</Label>
                        <Input
                          value={effect.webhookKey}
                          placeholder="MARKETING_SLACK_WEBHOOK"
                          onChange={(event) =>
                            setDraft((current) =>
                              current
                                ? {
                                    ...current,
                                    effects: current.effects.map(
                                      (candidate, at) =>
                                        at === index &&
                                        candidate.kind === "team_slack"
                                          ? {
                                              ...candidate,
                                              webhookKey: event.target.value,
                                            }
                                          : candidate,
                                    ),
                                  }
                                : current,
                            )
                          }
                        />
                      </div>
                    ) : effect.kind === "webhook" ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="grid gap-2">
                          <Label>{t("database.webhookUrlSecretKey")}</Label>
                          <Input
                            value={effect.urlKey}
                            placeholder="PUBLISH_WEBHOOK_URL"
                            onChange={(event) =>
                              setDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      effects: current.effects.map(
                                        (candidate, at) =>
                                          at === index &&
                                          candidate.kind === "webhook"
                                            ? {
                                                ...candidate,
                                                urlKey: event.target.value,
                                              }
                                            : candidate,
                                      ),
                                    }
                                  : current,
                              )
                            }
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label>{t("database.webhookSigningSecretKey")}</Label>
                          <Input
                            value={effect.signatureKey}
                            placeholder="PUBLISH_WEBHOOK_SIGNING_SECRET"
                            onChange={(event) =>
                              setDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      effects: current.effects.map(
                                        (candidate, at) =>
                                          at === index &&
                                          candidate.kind === "webhook"
                                            ? {
                                                ...candidate,
                                                signatureKey:
                                                  event.target.value,
                                              }
                                            : candidate,
                                      ),
                                    }
                                  : current,
                              )
                            }
                          />
                        </div>
                      </div>
                    ) : effect.kind === "set_property" ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="grid gap-2">
                          <Label>{t("database.propertyToSet")}</Label>
                          <Select
                            value={effect.propertyId}
                            onValueChange={(propertyId) =>
                              setDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      effects: current.effects.map(
                                        (candidate, at) =>
                                          at === index &&
                                          candidate.kind === "set_property"
                                            ? {
                                                ...candidate,
                                                propertyId,
                                                value: null,
                                              }
                                            : candidate,
                                      ),
                                    }
                                  : current,
                              )
                            }
                          >
                            <SelectTrigger>
                              <SelectValue
                                placeholder={t("database.chooseAProperty")}
                              />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {deterministicEffectProperties(properties).map(
                                  (property) => (
                                    <SelectItem
                                      key={property.definition.id}
                                      value={property.definition.id}
                                    >
                                      {property.definition.name}
                                    </SelectItem>
                                  ),
                                )}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid gap-2">
                          <Label>{t("database.propertyValue")}</Label>
                          <Input
                            value={
                              typeof effect.value === "string"
                                ? effect.value
                                : JSON.stringify(effect.value)
                            }
                            placeholder={t("database.propertyValuePlaceholder")}
                            onChange={(event) => {
                              const raw = event.target.value;
                              let value: unknown = raw;
                              try {
                                value = JSON.parse(raw);
                              } catch {
                                value = raw;
                              }
                              setDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      effects: current.effects.map(
                                        (candidate, at) =>
                                          at === index &&
                                          candidate.kind === "set_property"
                                            ? { ...candidate, value }
                                            : candidate,
                                      ),
                                    }
                                  : current,
                              );
                            }}
                          />
                        </div>
                      </div>
                    ) : (
                      assertNever(effect)
                    )}
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
                <div>
                  <Label htmlFor="hook-enabled">
                    {t("database.ruleEnabled")}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {t("database.ruleEnabledDescription")}
                  </p>
                </div>
                <Switch
                  id="hook-enabled"
                  checked={draft.enabled}
                  onCheckedChange={(enabled) =>
                    setDraft((current) =>
                      current ? { ...current, enabled } : current,
                    )
                  }
                />
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                {draft.hookId ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    disabled={manageHook.isPending}
                    onClick={() => setDeleteConfirmationOpen(true)}
                  >
                    <IconTrash className="size-4" />
                    {t("database.deleteRule")}
                  </Button>
                ) : (
                  <span />
                )}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setDraft(null)}
                  >
                    {t("database.cancel")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={
                      manageHook.isPending ||
                      !draft.name.trim() ||
                      !draft.effects.length ||
                      !draft.effects.every(validEffect) ||
                      draftTriggerAvailability?.available !== true ||
                      (draft.triggerKind === "property_changed" &&
                        !draft.propertyId)
                    }
                    onClick={() => void saveDraft()}
                  >
                    {manageHook.isPending ? (
                      <Spinner className="size-4" />
                    ) : null}
                    {t("database.saveRule")}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <details className="group border-t border-border pt-3">
        <summary className="cursor-pointer list-none text-xs font-medium text-muted-foreground hover:text-foreground">
          {t("database.latestHookExecutions")}
        </summary>
        <div className="mt-3 grid gap-1">
          {executions.length ? (
            executions.map((execution) => {
              return (
                <div
                  key={execution.id}
                  className="flex items-start justify-between gap-3 rounded-md px-2 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {execution.hookName ?? t("database.deletedRule")}
                    </div>
                    {execution.error ? (
                      <div className="mt-0.5 line-clamp-2 text-muted-foreground">
                        {execution.error}
                      </div>
                    ) : null}
                    {execution.effects.map((effect) => {
                      const outcome = effect.result?.outcome;
                      if (
                        outcome !== "cycle_detected" &&
                        outcome !== "max_chain_depth_exceeded"
                      ) {
                        return null;
                      }
                      return (
                        <div
                          key={effect.id}
                          className="mt-0.5 line-clamp-2 text-muted-foreground"
                        >
                          {t(
                            outcome === "cycle_detected"
                              ? "database.hookCycleStopped"
                              : "database.hookDepthStopped",
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <span className="shrink-0 capitalize text-muted-foreground">
                    {t(executionStatusKey(execution.status))}
                  </span>
                </div>
              );
            })
          ) : (
            <p className="py-3 text-xs text-muted-foreground">
              {t("database.noHookExecutions")}
            </p>
          )}
        </div>
      </details>

      <AlertDialog
        open={deleteConfirmationOpen}
        onOpenChange={setDeleteConfirmationOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("database.deleteNotificationRuleQuestion")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("database.deleteNotificationRuleDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("database.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={manageHook.isPending}
              onClick={() => {
                if (!draft?.hookId) return;
                void deleteHook(draft.hookId);
              }}
            >
              {t("database.deleteRule")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
