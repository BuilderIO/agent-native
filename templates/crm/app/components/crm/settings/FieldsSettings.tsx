import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconAlertTriangle,
  IconArchive,
  IconArrowBackUp,
  IconLock,
  IconPencil,
  IconPlus,
  IconTags,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import type {
  CrmAttributeDefinition,
  CrmAttributeType,
} from "../../../../shared/crm-contract";
import { AttributeOptionsEditor } from "./AttributeOptionsEditor";
import {
  applyAttributePatch,
  attributeEditDraft,
  attributeTypeCapabilities,
  ATTRIBUTE_AUTHORITY_INFO,
  AUTHORED_ATTRIBUTE_TYPES,
  buildCreateAttributeInput,
  buildUpdateAttributeInput,
  emptyAttributeDraft,
  emptyAttributeOptionDraft,
  hasAttributeEdits,
  type AttributeDraft,
  type AttributeEditDraft,
  type CrmAttributeListResult,
  type UpdateAttributeInput,
} from "./settings-admin";

interface CrmConnectionSummary {
  id: string;
  provider: string;
  label: string;
  mode: string;
  objectTypes: string[];
}

interface CrmListSummary {
  id: string;
  connectionId: string;
  name: string;
  parentObjectType: string;
  archived: boolean;
}

interface FieldsTarget {
  key: string;
  target: "object" | "list";
  targetId: string;
  connectionId: string;
  label: string;
  group: string;
}

export function FieldsSettings() {
  const t = useT();
  const queryClient = useQueryClient();
  const connectionsQuery = useActionQuery<{
    connections: CrmConnectionSummary[];
  }>("list-crm-connections" as never, {} as never);
  const listsQuery = useActionQuery<{ lists: CrmListSummary[] }>(
    "list-crm-lists" as never,
    { limit: 100 } as never,
  );

  const targets = useMemo<FieldsTarget[]>(() => {
    const connections = connectionsQuery.data?.connections ?? [];
    const objectTargets = connections.flatMap((connection) =>
      connection.objectTypes.map((objectType) => ({
        key: `object:${connection.id}:${objectType}`,
        target: "object" as const,
        targetId: objectType,
        connectionId: connection.id,
        label: objectType,
        group: connection.label,
      })),
    );
    const listTargets = (listsQuery.data?.lists ?? [])
      .filter((list) => !list.archived)
      .map((list) => ({
        key: `list:${list.id}`,
        target: "list" as const,
        targetId: list.id,
        connectionId: list.connectionId,
        label: list.name,
        group: t("fields.listsGroup"),
      }));
    return [...objectTargets, ...listTargets];
  }, [connectionsQuery.data, listsQuery.data, t]);

  const [targetKey, setTargetKey] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const activeTarget =
    targets.find((target) => target.key === targetKey) ?? targets[0];

  const attributeParams = activeTarget
    ? {
        target: activeTarget.target,
        targetId: activeTarget.targetId,
        connectionId: activeTarget.connectionId,
        includeArchived,
      }
    : undefined;
  const attributesKey = ["action", "list-crm-attributes", attributeParams];
  const attributesQuery = useActionQuery<CrmAttributeListResult>(
    "list-crm-attributes" as never,
    attributeParams as never,
    { enabled: Boolean(activeTarget) } as never,
  );

  /**
   * Writes the optimistic state and hands back the undo. An error path that
   * cannot restore the previous rows would leave the table asserting a change
   * the server refused.
   */
  function patchAttribute(
    attributeId: string,
    patch: Partial<CrmAttributeDefinition>,
  ) {
    void queryClient.cancelQueries({ queryKey: attributesKey });
    const previous =
      queryClient.getQueryData<CrmAttributeListResult>(attributesKey);
    queryClient.setQueryData(
      attributesKey,
      applyAttributePatch(previous, attributeId, patch),
    );
    return () => queryClient.setQueryData(attributesKey, previous);
  }

  const attributes = attributesQuery.data?.attributes ?? [];
  const loadFailed = connectionsQuery.isError || listsQuery.isError;

  return (
    <TooltipProvider>
      <div className="mx-auto w-full max-w-4xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">
              {t("fields.title")}
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              {t("fields.description")}
            </p>
          </div>
          {activeTarget ? (
            <CreateAttributeDialog
              target={activeTarget}
              onCreated={() =>
                void queryClient.invalidateQueries({
                  queryKey: ["action", "list-crm-attributes"],
                })
              }
            />
          ) : null}
        </div>

        <AuthorityLegend />

        {loadFailed ? (
          <div className="mt-6 flex items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3">
            <IconAlertTriangle className="size-4 shrink-0 text-destructive" />
            <p className="flex-1 text-sm">{t("fields.targetsLoadFailed")}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void connectionsQuery.refetch();
                void listsQuery.refetch();
              }}
            >
              {t("fields.retry")}
            </Button>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap items-end gap-4">
          <div className="grid min-w-56 gap-2">
            <Label htmlFor="fields-target">{t("fields.target")}</Label>
            <Select
              value={activeTarget?.key ?? ""}
              onValueChange={setTargetKey}
              disabled={!targets.length}
            >
              <SelectTrigger id="fields-target">
                <SelectValue placeholder={t("fields.targetPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {groupTargets(targets).map(([group, groupTargetList]) => (
                  <SelectGroup key={group}>
                    <SelectLabel>{group}</SelectLabel>
                    {groupTargetList.map((target) => (
                      <SelectItem key={target.key} value={target.key}>
                        {target.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm text-muted-foreground">
            <Switch
              checked={includeArchived}
              onCheckedChange={setIncludeArchived}
              aria-label={t("fields.showArchived")}
            />
            {t("fields.showArchived")}
          </label>
        </div>

        {attributesQuery.isError ? (
          <div className="mt-6 flex items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3">
            <IconAlertTriangle className="size-4 shrink-0 text-destructive" />
            <p className="flex-1 text-sm">
              {attributesQuery.error instanceof Error
                ? attributesQuery.error.message
                : t("fields.attributesLoadFailed")}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void attributesQuery.refetch()}
            >
              {t("fields.retry")}
            </Button>
          </div>
        ) : attributes.length ? (
          <div className="mt-4 overflow-x-auto rounded-lg border border-border/70">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("fields.columnName")}</TableHead>
                  <TableHead>{t("fields.columnSlug")}</TableHead>
                  <TableHead>{t("fields.columnType")}</TableHead>
                  <TableHead>{t("fields.columnAuthority")}</TableHead>
                  <TableHead>{t("fields.columnRules")}</TableHead>
                  <TableHead className="text-end">
                    {t("fields.columnActions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attributes.map((attribute) => (
                  <AttributeRow
                    key={attribute.id}
                    attribute={attribute}
                    patchAttribute={patchAttribute}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        ) : connectionsQuery.isLoading ||
          listsQuery.isLoading ||
          attributesQuery.isLoading ? (
          <div
            className="mt-4 space-y-2"
            role="status"
            aria-busy="true"
            aria-label={t("fields.loading")}
          >
            {[0, 1, 2, 3].map((item) => (
              <div
                key={item}
                className="grid grid-cols-4 gap-4 rounded-lg border border-border/70 bg-card px-4 py-3.5"
              >
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-32" />
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-dashed border-border px-4 py-10 text-center">
            <p className="text-sm font-medium">{t("fields.emptyTitle")}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("fields.emptyDescription")}
            </p>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

function groupTargets(
  targets: FieldsTarget[],
): Array<[string, FieldsTarget[]]> {
  const groups = new Map<string, FieldsTarget[]>();
  for (const target of targets) {
    groups.set(target.group, [...(groups.get(target.group) ?? []), target]);
  }
  return [...groups.entries()];
}

function AuthorityLegend() {
  const t = useT();
  return (
    <div className="mt-5 grid gap-3 rounded-lg border border-border/70 bg-card p-4 sm:grid-cols-3">
      {(["local-authoritative", "derived-local", "provider"] as const).map(
        (authority) => {
          const info = ATTRIBUTE_AUTHORITY_INFO[authority];
          return (
            <div key={authority} className="grid gap-1">
              <Badge variant={info.badge} className="w-fit font-normal">
                {t(info.labelKey)}
              </Badge>
              <p className="text-xs leading-5 text-muted-foreground">
                {t(info.descriptionKey)}
              </p>
            </div>
          );
        },
      )}
    </div>
  );
}

function AttributeRow({
  attribute,
  patchAttribute,
}: {
  attribute: CrmAttributeDefinition;
  patchAttribute: (
    attributeId: string,
    patch: Partial<CrmAttributeDefinition>,
  ) => () => void;
}) {
  const t = useT();
  const authority = ATTRIBUTE_AUTHORITY_INFO[attribute.authority];
  const capabilities = attributeTypeCapabilities(attribute.attributeType);
  const rules = [
    attribute.required ? t("fields.ruleRequired") : null,
    attribute.uniqueValue ? t("fields.ruleUnique") : null,
    attribute.historyTracked ? t("fields.ruleHistory") : null,
    attribute.multi ? t("fields.ruleMulti") : null,
  ].filter(Boolean) as string[];

  return (
    <TableRow className={attribute.archived ? "opacity-60" : undefined}>
      <TableCell className="font-medium">
        <span className="flex flex-wrap items-center gap-2">
          {attribute.label}
          {attribute.archived ? (
            <Badge variant="outline" className="font-normal">
              {t("fields.archived")}
            </Badge>
          ) : null}
        </span>
        {attribute.description ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {attribute.description}
          </p>
        ) : null}
      </TableCell>
      <TableCell>
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
          {attribute.apiSlug}
        </code>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {attribute.attributeType}
      </TableCell>
      <TableCell>
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Badge variant={authority.badge} className="font-normal">
              {t(authority.labelKey)}
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-64">
            {t(authority.descriptionKey)}
          </TooltipContent>
        </Tooltip>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {rules.length ? rules.join(" · ") : t("fields.ruleNone")}
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-1">
          {capabilities.usesOptions ? (
            <AttributeOptionsEditor
              attribute={attribute}
              patchAttribute={patchAttribute}
              trigger={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("fields.editOptionsAria", {
                    name: attribute.label,
                  })}
                >
                  <IconTags className="size-4" />
                </Button>
              }
            />
          ) : null}
          <EditAttributeDialog
            attribute={attribute}
            patchAttribute={patchAttribute}
          />
          <ArchiveAttributeButton
            attribute={attribute}
            patchAttribute={patchAttribute}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}

/**
 * `api_slug` and the attribute type are shown, never offered: the actions
 * reject a change to either because stored value rows are keyed by the slug and
 * typed by the type.
 */
function ImmutableField({
  label,
  value,
  explanation,
}: {
  label: string;
  value: string;
  explanation: string;
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <div className="flex cursor-help items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            <IconLock className="size-3.5 shrink-0" />
            <code className="truncate">{value}</code>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-72">
          {explanation}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function EditAttributeDialog({
  attribute,
  patchAttribute,
}: {
  attribute: CrmAttributeDefinition;
  patchAttribute: (
    attributeId: string,
    patch: Partial<CrmAttributeDefinition>,
  ) => () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AttributeEditDraft>(() =>
    attributeEditDraft(attribute),
  );
  const update = useActionMutation<unknown, UpdateAttributeInput>(
    "update-crm-attribute" as never,
  );

  function openChange(next: boolean) {
    if (next) setDraft(attributeEditDraft(attribute));
    setOpen(next);
  }

  async function save() {
    const input = buildUpdateAttributeInput(attribute, draft);
    if (!hasAttributeEdits(input)) {
      setOpen(false);
      return;
    }
    setOpen(false);
    const rollback = patchAttribute(attribute.id, {
      label: draft.title.trim() || attribute.label,
      description: draft.description.trim() || undefined,
      required: draft.required,
      historyTracked: draft.historyTracked,
    });
    try {
      await update.mutateAsync(input);
    } catch (error) {
      rollback();
      toast.error(
        error instanceof Error ? error.message : t("fields.updateFailed"),
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={openChange}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("fields.editAria", { name: attribute.label })}
        >
          <IconPencil className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("fields.editTitle")}</DialogTitle>
          <DialogDescription>{t("fields.editDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="attribute-title">{t("fields.name")}</Label>
            <Input
              id="attribute-title"
              value={draft.title}
              maxLength={200}
              onChange={(event) =>
                setDraft({ ...draft, title: event.target.value })
              }
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <ImmutableField
              label={t("fields.columnSlug")}
              value={attribute.apiSlug}
              explanation={t("fields.slugImmutable")}
            />
            <ImmutableField
              label={t("fields.columnType")}
              value={attribute.attributeType}
              explanation={t("fields.typeImmutable")}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="attribute-description">
              {t("fields.attributeDescription")}
            </Label>
            <Textarea
              id="attribute-description"
              value={draft.description}
              maxLength={2000}
              onChange={(event) =>
                setDraft({ ...draft, description: event.target.value })
              }
            />
          </div>
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>
              {t("fields.required")}
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {t("fields.requiredHelp")}
              </span>
            </span>
            <Switch
              checked={draft.required}
              onCheckedChange={(required) => setDraft({ ...draft, required })}
            />
          </label>
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>
              {t("fields.historyTracked")}
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {t("fields.historyTrackedHelp")}
              </span>
            </span>
            <Switch
              checked={draft.historyTracked}
              onCheckedChange={(historyTracked) =>
                setDraft({ ...draft, historyTracked })
              }
            />
          </label>
          {ATTRIBUTE_AUTHORITY_INFO[attribute.authority]
            .editsBecomeProposals ? (
            <p className="rounded-md border border-border/70 bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
              {t("fields.providerEditNote")}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button onClick={() => void save()}>{t("fields.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ArchiveAttributeButton({
  attribute,
  patchAttribute,
}: {
  attribute: CrmAttributeDefinition;
  patchAttribute: (
    attributeId: string,
    patch: Partial<CrmAttributeDefinition>,
  ) => () => void;
}) {
  const t = useT();
  const archive = useActionMutation<unknown, { attributeId: string }>(
    "archive-crm-attribute" as never,
  );
  const update = useActionMutation<
    unknown,
    { attributeId: string; archived: boolean }
  >("update-crm-attribute" as never);

  async function restore() {
    const rollback = patchAttribute(attribute.id, { archived: false });
    try {
      await update.mutateAsync({
        attributeId: attribute.id,
        archived: false,
      });
    } catch (error) {
      rollback();
      toast.error(
        error instanceof Error ? error.message : t("fields.updateFailed"),
      );
    }
  }

  async function run() {
    const rollback = patchAttribute(attribute.id, { archived: true });
    try {
      await archive.mutateAsync({ attributeId: attribute.id });
    } catch (error) {
      rollback();
      toast.error(
        error instanceof Error ? error.message : t("fields.archiveFailed"),
      );
    }
  }

  if (attribute.archived) {
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("fields.restoreAria", { name: attribute.label })}
        onClick={() => void restore()}
      >
        <IconArrowBackUp className="size-4" />
      </Button>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("fields.archiveAria", { name: attribute.label })}
        >
          <IconArchive className="size-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("fields.archiveTitle", { name: attribute.label })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("fields.archiveDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("fields.cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={() => void run()}>
            {t("fields.archive")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function CreateAttributeDialog({
  target,
  onCreated,
}: {
  target: FieldsTarget;
  onCreated: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AttributeDraft>(emptyAttributeDraft);
  const create = useActionMutation<unknown, Record<string, unknown>>(
    "create-crm-attribute" as never,
  );
  const capabilities = attributeTypeCapabilities(draft.type);

  function openChange(next: boolean) {
    if (!next) setDraft(emptyAttributeDraft());
    setOpen(next);
  }

  async function submit() {
    try {
      await create.mutateAsync(
        buildCreateAttributeInput(draft, {
          target: target.target,
          targetId: target.targetId,
          connectionId: target.connectionId,
        }) as unknown as Record<string, unknown>,
      );
      openChange(false);
      onCreated();
      toast.success(t("fields.created"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("fields.createFailed"),
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={openChange}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <IconPlus className="size-4" /> {t("fields.newAttribute")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("fields.createTitle")}</DialogTitle>
          <DialogDescription>
            {t("fields.createDescription", { target: target.label })}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="new-attribute-title">{t("fields.name")}</Label>
            <Input
              id="new-attribute-title"
              value={draft.title}
              maxLength={200}
              onChange={(event) =>
                setDraft({ ...draft, title: event.target.value })
              }
            />
            <p className="text-xs text-muted-foreground">
              {t("fields.slugDerivedHelp")}
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-attribute-type">{t("fields.columnType")}</Label>
            <Select
              value={draft.type}
              onValueChange={(value) =>
                setDraft({ ...draft, type: value as CrmAttributeType })
              }
            >
              <SelectTrigger id="new-attribute-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AUTHORED_ATTRIBUTE_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t("fields.typeImmutable")}
            </p>
          </div>
          {capabilities.supportsMulti ? (
            <label className="flex items-center justify-between gap-4 text-sm">
              <span>{t("fields.multi")}</span>
              <Switch
                checked={draft.multi}
                onCheckedChange={(multi) => setDraft({ ...draft, multi })}
              />
            </label>
          ) : null}
          {capabilities.usesOptions ? (
            <NewOptionsField
              draft={draft}
              showStageFields={capabilities.showsStageFields}
              onChange={(options) => setDraft({ ...draft, options })}
            />
          ) : null}
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>{t("fields.required")}</span>
            <Switch
              checked={draft.required}
              onCheckedChange={(required) => setDraft({ ...draft, required })}
            />
          </label>
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>{t("fields.uniqueValue")}</span>
            <Switch
              checked={draft.uniqueValue}
              onCheckedChange={(uniqueValue) =>
                setDraft({ ...draft, uniqueValue })
              }
            />
          </label>
        </div>
        <DialogFooter>
          <Button
            disabled={!draft.title.trim() || create.isPending}
            onClick={() => void submit()}
          >
            {t("fields.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewOptionsField({
  draft,
  showStageFields,
  onChange,
}: {
  draft: AttributeDraft;
  showStageFields: boolean;
  onChange: (options: AttributeDraft["options"]) => void;
}) {
  const t = useT();
  return (
    <div className="grid gap-2">
      <Label>{t("fields.options")}</Label>
      {draft.options.map((option, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2">
          <Input
            className="flex-1"
            value={option.value}
            maxLength={200}
            placeholder={t("fields.optionValuePlaceholder")}
            onChange={(event) =>
              onChange(
                draft.options.map((current, position) =>
                  position === index
                    ? { ...current, value: event.target.value }
                    : current,
                ),
              )
            }
          />
          {showStageFields ? (
            <Input
              className="w-28"
              type="number"
              min={0}
              value={option.targetDays ?? ""}
              placeholder={t("fields.targetDays")}
              onChange={(event) =>
                onChange(
                  draft.options.map((current, position) =>
                    position === index
                      ? {
                          ...current,
                          targetDays: event.target.value
                            ? Number(event.target.value)
                            : null,
                        }
                      : current,
                  ),
                )
              }
            />
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              onChange(
                draft.options.filter((_, position) => position !== index),
              )
            }
          >
            {t("fields.remove")}
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="w-fit gap-1.5"
        onClick={() =>
          onChange([...draft.options, emptyAttributeOptionDraft()])
        }
      >
        <IconPlus className="size-4" /> {t("fields.addOption")}
      </Button>
    </div>
  );
}
