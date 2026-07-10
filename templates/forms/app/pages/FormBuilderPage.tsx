import {
  AgentToggleButton,
  ShareButton,
  appPath,
  useFormatters,
  useReconciledState,
  useSendToAgentChat,
  useT,
} from "@agent-native/core/client";
import type {
  FormField,
  FormFieldType,
  FormIntegration,
  FormSettings,
  IntegrationType,
} from "@shared/types";
import {
  IconExternalLink,
  IconCheck,
  IconGripVertical,
  IconPlus,
  IconChevronDown,
  IconCopy,
  IconArrowUp,
  IconArrowDown,
  IconArrowsSort,
  IconMessage,
  IconGlobe,
  IconHash,
  IconSearch,
  IconTrash,
  IconWebhook,
  IconDownload,
  IconRefresh,
  IconLoader2,
  IconDots,
  IconLock,
  IconArchive,
} from "@tabler/icons-react";
import { format } from "date-fns";
import { nanoid } from "nanoid";
import { useState, useCallback, useRef, useEffect } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import { FieldPropertiesPanel } from "@/components/builder/FieldPropertiesPanel";
import { FieldRenderer } from "@/components/builder/FieldRenderer";
import { CloudUpgrade } from "@/components/CloudUpgrade";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { useAgentPromptRun } from "@/hooks/use-agent-prompt-run";
import { useDbStatus } from "@/hooks/use-db-status";
import {
  useForm,
  useUpdateForm,
  usePatchFormFields,
  useDeleteForm,
} from "@/hooks/use-forms";
import { useFormResponses } from "@/hooks/use-responses";
import {
  formBuilderTabSearchParam,
  normalizeFormBuilderTab,
  type FormBuilderTab,
} from "@/lib/form-builder-tabs";
import { normalizeFields } from "@/lib/normalize-fields";
import { cn } from "@/lib/utils";

type Translator = ReturnType<typeof useT>;

function getFieldTypeDefaults(
  t: Translator,
): Record<FormFieldType, Partial<FormField>> {
  const defaultOptions = [
    t("builder.fieldDefaults.option1"),
    t("builder.fieldDefaults.option2"),
    t("builder.fieldDefaults.option3"),
  ];
  return {
    text: {
      label: t("builder.fieldDefaults.textLabel"),
      placeholder: t("builder.fieldDefaults.textPlaceholder"),
    },
    email: {
      label: t("builder.fieldDefaults.emailLabel"),
      placeholder: t("builder.fieldDefaults.emailPlaceholder"),
    },
    number: {
      label: t("builder.fieldDefaults.numberLabel"),
      placeholder: "0",
    },
    textarea: {
      label: t("builder.fieldDefaults.textareaLabel"),
      placeholder: t("builder.fieldDefaults.textareaPlaceholder"),
    },
    select: {
      label: t("builder.fieldDefaults.selectLabel"),
      options: defaultOptions,
    },
    multiselect: {
      label: t("builder.fieldDefaults.multiselectLabel"),
      options: defaultOptions,
    },
    checkbox: { label: t("builder.fieldDefaults.checkboxLabel") },
    radio: {
      label: t("builder.fieldDefaults.radioLabel"),
      options: defaultOptions,
    },
    date: { label: t("builder.fieldDefaults.dateLabel") },
    rating: { label: t("builder.fieldDefaults.ratingLabel") },
    scale: {
      label: t("builder.fieldDefaults.scaleLabel"),
      validation: { min: 1, max: 10 },
    },
  };
}

type FieldOp =
  | { op: "upsert"; field: Record<string, any> }
  | { op: "remove"; id: string }
  | { op: "reorder"; ids: string[] };

export function FormBuilderPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const { data: form, isLoading, error, refetch } = useForm(id!);
  const updateForm = useUpdateForm();
  const patchFormFields = usePatchFormFields();
  const deleteForm = useDeleteForm();
  const role = (form as any)?.role as
    | "owner"
    | "viewer"
    | "editor"
    | "admin"
    | undefined;
  const canEdit = role === "owner" || role === "editor" || role === "admin";
  const canArchive = role === "owner" || role === "admin";

  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<FormBuilderTab>(() =>
    normalizeFormBuilderTab(tabParam),
  );
  const activeBuilderTab: FormBuilderTab = canEdit ? activeTab : "edit";
  const [copied, setCopied] = useState(false);
  // Target status while a publish/unpublish is in flight (and until the cache
  // refetch catches up). `null` once the displayed form.status matches it.
  const [pendingStatus, setPendingStatus] = useState<
    "published" | "draft" | null
  >(null);
  const { isLocal } = useDbStatus();
  const [showCloudUpgrade, setShowCloudUpgrade] = useState(false);
  const publishedFormUrl =
    form?.status === "published" && typeof window !== "undefined"
      ? `${window.location.origin}${appPath(`/f/${form.slug}`)}`
      : undefined;
  const [agentPopoverOpen, setAgentPopoverOpen] = useState(false);
  const [agentPrompt, setAgentPrompt] = useState("");
  const agentPromptRef = useRef<HTMLTextAreaElement>(null);
  const { send, codeRequiredDialog } = useSendToAgentChat();
  const promptRun = useAgentPromptRun({
    staleMessage: t("builder.agentEditStale"),
  });
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  const setBuilderTab = useCallback(
    (value: string) => {
      const nextTab = normalizeFormBuilderTab(value);
      setActiveTab(nextTab);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("tab", formBuilderTabSearchParam(nextTab));
      setSearchParams(nextParams);
    },
    [searchParams, setSearchParams],
  );

  useEffect(() => {
    setActiveTab(normalizeFormBuilderTab(tabParam));
  }, [tabParam]);

  useEffect(() => {
    if (!form) return;
    const canonicalTab = formBuilderTabSearchParam(activeBuilderTab);
    const currentTab = tabParam === "results" ? "responses" : tabParam;
    if (currentTab === canonicalTab && tabParam !== "results") return;

    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("tab", canonicalTab);
    setSearchParams(nextParams, { replace: true });
  }, [activeBuilderTab, form, searchParams, setSearchParams, tabParam]);

  // Local state for text inputs and fields — prevents polling-driven refetches
  // from resetting input values while the user is typing or losing optimistic
  // updates (e.g. newly added fields). `useReconciledState` re-adopts the
  // server/agent value whenever the field isn't focused, so an agent edit to
  // the title/description shows up live without yanking in-progress typing.
  const titleFocused = useRef(false);
  const descriptionFocused = useRef(false);
  const fieldsDirty = useRef(false);
  const [localTitle, setLocalTitle] = useReconciledState(form?.title ?? "", {
    active: titleFocused.current,
  });
  const [localDescription, setLocalDescription] = useReconciledState(
    form?.description ?? "",
    { active: descriptionFocused.current },
  );
  const [localFields, setLocalFields] = useState<FormField[]>(
    normalizeFields(form?.fields),
  );
  const titleMeasureRef = useRef<HTMLSpanElement>(null);
  const [titleInputWidth, setTitleInputWidth] = useState<number | undefined>();

  // Esc to deselect field
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && selectedFieldId) {
        setSelectedFieldId(null);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedFieldId]);

  // Measure title text width for auto-sizing input
  useEffect(() => {
    if (titleMeasureRef.current) {
      setTitleInputWidth(Math.max(titleMeasureRef.current.offsetWidth + 4, 60));
    }
  }, [localTitle]);

  // Sync fields from server when not dirty (e.g. agent updates the fields).
  // Title/description re-sync is handled by `useReconciledState` above.
  useEffect(() => {
    if (form && !fieldsDirty.current)
      setLocalFields(normalizeFields(form.fields));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form?.fields]);

  // Clear pending publish state once the refetched form reflects the new
  // status — otherwise the spinner stops before the badge/label updates.
  useEffect(() => {
    if (pendingStatus && form?.status === pendingStatus) {
      setPendingStatus(null);
    }
  }, [form?.status, pendingStatus]);

  // Auto-grow description textarea
  useEffect(() => {
    const el = descriptionRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }
  }, [localDescription]);

  // Debounced save for non-field form properties (title, description, status,
  // settings). Full-array field saves are handled by saveFieldOps below.
  const saveTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const save = useCallback(
    (data: Parameters<typeof updateForm.mutate>[0]) => {
      clearTimeout(saveTimeout.current);
      saveTimeout.current = setTimeout(() => {
        updateForm.mutate(data, {
          onSettled: () => {
            fieldsDirty.current = false;
          },
        });
      }, 500);
    },
    [updateForm],
  );

  // Debounced field-op save — uses patch-form-fields (server-side merge) so
  // concurrent edits to different fields both survive.
  const fieldOpTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pendingOps = useRef<FieldOp[]>([]);
  const saveFieldOps = useCallback(
    (ops: FieldOp[]) => {
      const formId = form?.id;
      if (!formId) return;
      pendingOps.current = [...pendingOps.current, ...ops];
      clearTimeout(fieldOpTimeout.current);
      fieldOpTimeout.current = setTimeout(() => {
        const opsToSend = pendingOps.current;
        pendingOps.current = [];
        patchFormFields.mutate(
          { id: formId, ops: opsToSend },
          {
            onSettled: () => {
              fieldsDirty.current = false;
            },
          },
        );
      }, 500);
    },
    [patchFormFields, form?.id],
  );

  useEffect(
    () => () => {
      clearTimeout(saveTimeout.current);
      clearTimeout(fieldOpTimeout.current);
    },
    [],
  );

  if (isLoading || (!form && !error)) {
    return (
      <div className="flex flex-col h-full">
        {/* Top bar */}
        <div className="flex items-center justify-between border-b border-border ps-12 pe-2 sm:px-4 md:ps-4 h-14 shrink-0 min-w-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-14 rounded-full" />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Skeleton className="h-8 w-8 rounded-md" />
            <Skeleton className="h-8 w-20 rounded-md" />
          </div>
        </div>
        {/* Body: builder + properties */}
        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 overflow-auto p-4 sm:p-6">
            <div className="max-w-2xl mx-auto space-y-4">
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <div className="space-y-3 pt-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="border border-border rounded-lg p-4 space-y-3"
                  >
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-9 w-full" />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="hidden lg:block w-72 border-s border-border p-4 space-y-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (error && !form) {
    // `get-form` throws the same "not found" for both missing forms and forms
    // the current user has no access to. Phrase the message so it works for
    // both without leaking which case applies.
    const errorMessage = error instanceof Error ? error.message : "";
    const isAccessIssue = /not found|forbidden|no access/i.test(errorMessage);
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm text-muted-foreground">
          {isAccessIssue ? t("builder.accessDenied") : t("builder.loadFailed")}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/forms")}
          >
            {t("builder.backToForms")}
          </Button>
          {!isAccessIssue && (
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              {t("common.retry")}
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (!form) return null;
  const loadedForm = form;

  const fields = localFields;
  const selectedField = fields.find((f) => f.id === selectedFieldId);
  // Viewers can see the form but not edit it or peek at responses / settings /
  // integrations. The role is set by `get-form` based on ownership + shares.

  function addField(type: FormFieldType) {
    const fieldTypeDefaults = getFieldTypeDefaults(t);
    const defaults = fieldTypeDefaults[type] || {};
    const newField: FormField = {
      id: nanoid(8),
      type,
      label: defaults.label || t("builder.fieldDefaults.newField"),
      placeholder: defaults.placeholder,
      required: false,
      options: defaults.options,
      validation: defaults.validation,
      width: "full",
    };
    setLocalFields((prev) => [...prev, newField]);
    fieldsDirty.current = true;
    saveFieldOps([{ op: "upsert", field: newField }]);
    setSelectedFieldId(newField.id);
  }

  function updateField(updated: FormField) {
    setLocalFields((prev) =>
      prev.map((f) => (f.id === updated.id ? updated : f)),
    );
    fieldsDirty.current = true;
    saveFieldOps([{ op: "upsert", field: updated }]);
  }

  function deleteField(fieldId: string) {
    setLocalFields((prev) => prev.filter((f) => f.id !== fieldId));
    fieldsDirty.current = true;
    saveFieldOps([{ op: "remove", id: fieldId }]);
    if (selectedFieldId === fieldId) setSelectedFieldId(null);
  }

  function moveField(from: number, to: number) {
    setLocalFields((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      // Emit a reorder op with the new order.
      saveFieldOps([{ op: "reorder", ids: next.map((f) => f.id) }]);
      return next;
    });
    fieldsDirty.current = true;
  }

  function handleDragStart(idx: number) {
    setDragIdx(idx);
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    if (dragIdx !== null && dragIdx !== idx) {
      moveField(dragIdx, idx);
      setDragIdx(idx);
    }
  }

  function handleDragEnd() {
    setDragIdx(null);
  }

  function submitAgentPrompt() {
    const trimmed = agentPrompt.trim();
    if (!trimmed || promptRun.isActivePrompt(trimmed)) return;
    const context = `Current form:\nTitle: ${loadedForm.title}\nDescription: ${loadedForm.description || "None"}\nFields: ${JSON.stringify(fields, null, 2)}`;
    const result = send({ message: trimmed, context, submit: true });
    if (result === null) return;
    promptRun.trackRun(trimmed, result);
    setAgentPopoverOpen(false);
    setAgentPrompt("");
  }

  function handleTogglePublish() {
    const newStatus = loadedForm.status === "published" ? "draft" : "published";
    if (newStatus === "published" && isLocal) {
      setShowCloudUpgrade(true);
      return;
    }
    setPendingStatus(newStatus);
    updateForm.mutate(
      { id: loadedForm.id, status: newStatus },
      {
        onSuccess: () =>
          toast.success(
            newStatus === "published"
              ? t("builder.publishedToast")
              : t("builder.unpublishedToast"),
          ),
        // Errors (including publish-validation failures) are surfaced by
        // useUpdateForm's onError, which echoes the server's actual message.
        onError: () => setPendingStatus(null),
      },
    );
  }

  function handleArchiveForm() {
    deleteForm.mutate(
      { id: loadedForm.id },
      {
        onSuccess: () => {
          toast.success(t("forms.movedToArchive"));
          navigate("/forms");
        },
      },
    );
  }

  function copyShareLink() {
    if (loadedForm.status !== "published") {
      toast.info(t("builder.publishBeforeCopyToast"));
      return;
    }
    if (isLocal) {
      setShowCloudUpgrade(true);
      return;
    }
    const url = `${window.location.origin}${appPath(`/f/${loadedForm.slug}`)}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success(t("builder.linkCopiedToast"));
  }

  return (
    <div className="flex flex-col h-full">
      {codeRequiredDialog}
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-border ps-12 pe-2 sm:px-4 md:ps-4 h-14 shrink-0 min-w-0">
        <div className="flex items-center gap-2 sm:gap-3 relative min-w-0 flex-1 me-2">
          <span
            ref={titleMeasureRef}
            aria-hidden
            className="invisible absolute whitespace-pre text-sm font-medium pointer-events-none"
          >
            {localTitle || " "}
          </span>
          <Input
            value={localTitle}
            onChange={(e) => {
              setLocalTitle(e.target.value);
              save({ id: form.id, title: e.target.value });
            }}
            onFocus={() => (titleFocused.current = true)}
            onBlur={() => (titleFocused.current = false)}
            style={{ width: titleInputWidth }}
            className="h-8 text-sm font-medium border-none bg-transparent px-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 max-w-[50vw] sm:max-w-80"
          />
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] shrink-0 hidden sm:inline-flex",
              form.status === "published"
                ? "bg-emerald-600/10 text-emerald-600 border-emerald-600/20"
                : "bg-amber-600/10 text-amber-600 border-amber-600/20",
            )}
          >
            {form.status}
          </Badge>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {form.status === "published" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                  <a
                    href={appPath(`/f/${form.slug}`)}
                    target="_blank"
                    rel="noopener"
                  >
                    <IconExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {t("builder.previewPublishedForm")}
              </TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={copyShareLink}
                  disabled={form.status !== "published"}
                  aria-label={
                    form.status === "published"
                      ? t("builder.copyPublicFormLink")
                      : t("builder.publishBeforeCopyPublicFormLink")
                  }
                >
                  {copied ? (
                    <IconCheck className="h-4 w-4" />
                  ) : (
                    <IconCopy className="h-4 w-4" />
                  )}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {form.status === "published"
                ? copied
                  ? t("builder.publicLinkCopied")
                  : t("builder.copyPublishedPublicLink")
                : t("builder.publishBeforeCopyPublicLink")}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <ShareButton
                  resourceType="form"
                  resourceId={form.id}
                  resourceTitle={form.title}
                  triggerClassName="h-9 border-input bg-transparent px-3 text-xs hover:bg-accent hover:text-accent-foreground"
                  shareUrl={publishedFormUrl}
                  shareUrlLabel={t("builder.publicResponseLink")}
                  shareUrlDescription={t(
                    "builder.publicResponseLinkDescription",
                  )}
                  shareUrlPlacement="top"
                  shareUrlPlaceholder={t(
                    "builder.publicResponseLinkPlaceholder",
                  )}
                  peopleAccessLabel={t("builder.peopleAccessLabel")}
                  generalAccessLabel={t("builder.generalAccessLabel")}
                  visibilityCopy={{
                    private: {
                      description: t("builder.privateAccessDescription"),
                    },
                    org: {
                      description: t("builder.orgAccessDescription"),
                    },
                    public: {
                      label: t("builder.publicBuilderAccess"),
                      description: t("builder.publicAccessDescription"),
                    },
                  }}
                />
              </span>
            </TooltipTrigger>
            <TooltipContent>{t("builder.manageBuilderAccess")}</TooltipContent>
          </Tooltip>

          {canEdit && form.status !== "published" && (
            <Button
              size="sm"
              className="text-xs"
              onClick={handleTogglePublish}
              disabled={pendingStatus !== null}
            >
              {pendingStatus !== null && (
                <IconLoader2 className="h-3.5 w-3.5 me-1.5 animate-spin" />
              )}
              {pendingStatus === "published"
                ? t("builder.publishing")
                : pendingStatus === "draft"
                  ? t("builder.unpublishing")
                  : t("forms.publish")}
            </Button>
          )}
          {canEdit && form.status === "published" && (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 bg-transparent"
                      aria-label={t("forms.formActions")}
                    >
                      <IconDots className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>{t("builder.moreActions")}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={pendingStatus !== null}
                  onClick={handleTogglePublish}
                >
                  {pendingStatus === "draft" ? (
                    <IconLoader2 className="h-4 w-4 me-2 animate-spin" />
                  ) : (
                    <IconLock className="h-4 w-4 me-2" />
                  )}
                  {pendingStatus === "draft"
                    ? t("builder.unpublishing")
                    : t("forms.unpublish")}
                </DropdownMenuItem>
                {canArchive && (
                  <DropdownMenuItem onClick={handleArchiveForm}>
                    <IconArchive className="h-4 w-4 me-2" />
                    {t("forms.moveToArchive")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <AgentToggleButton />
        </div>
      </div>

      {/* Tab row — viewers only see Edit (which is read-only for them). The
          Results / Settings / Integrations tabs include responses and config
          data viewers shouldn't see. */}
      <div className="border-b border-border px-2 sm:px-4 py-2 shrink-0 overflow-x-auto">
        <Tabs
          value={activeBuilderTab}
          onValueChange={canEdit ? setBuilderTab : undefined}
        >
          <TabsList className="w-max sm:w-auto">
            <TabsTrigger value="edit" className="text-xs">
              {canEdit ? t("builder.editTab") : t("builder.previewTab")}
            </TabsTrigger>
            {canEdit && (
              <>
                <TabsTrigger value="responses" className="text-xs">
                  {t("builder.resultsTab")}
                  {(form.responseCount ?? 0) > 0 && (
                    <Badge
                      variant="secondary"
                      className="ms-1.5 text-[9px] px-1 py-0 h-4 min-w-4"
                    >
                      {form.responseCount}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="settings" className="text-xs">
                  {t("header.settings")}
                </TabsTrigger>
                <TabsTrigger value="integrations" className="text-xs">
                  {t("builder.integrationsTab")}
                </TabsTrigger>
              </>
            )}
          </TabsList>
        </Tabs>
      </div>

      {/* Tab content */}
      {activeBuilderTab === "edit" && (
        <BuilderContent
          form={form}
          fields={fields}
          selectedFieldId={selectedFieldId}
          selectedField={selectedField}
          dragIdx={dragIdx}
          localTitle={localTitle}
          localDescription={localDescription}
          descriptionRef={descriptionRef}
          titleFocused={titleFocused}
          descriptionFocused={descriptionFocused}
          agentPopoverOpen={agentPopoverOpen}
          agentPrompt={agentPrompt}
          agentPromptRef={agentPromptRef}
          promptRun={promptRun}
          canEdit={canEdit}
          onTitleChange={(v) => {
            setLocalTitle(v);
            save({ id: form.id, title: v });
          }}
          onDescriptionChange={(v) => {
            setLocalDescription(v);
            save({ id: form.id, description: v });
          }}
          onSelectField={setSelectedFieldId}
          onUpdateField={updateField}
          onDeleteField={deleteField}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onAddField={addField}
          onAgentPopoverChange={setAgentPopoverOpen}
          onAgentPromptChange={setAgentPrompt}
          onSubmitAgent={submitAgentPrompt}
        />
      )}

      {activeBuilderTab === "responses" && (
        <ResultsContent formId={form.id} form={form} />
      )}

      {activeBuilderTab === "settings" && (
        <div className="flex-1 overflow-auto">
          <div className="max-w-lg mx-auto py-4 sm:py-8 px-3 sm:px-4">
            <SettingsEditor
              key={JSON.stringify(form.settings)}
              form={form}
              onSave={(settings) => {
                save({ id: form.id, settings });
                toast.success(t("builder.settingsSaved"));
              }}
            />
          </div>
        </div>
      )}

      {activeBuilderTab === "integrations" && (
        <div className="flex-1 overflow-auto">
          <div className="max-w-lg mx-auto py-4 sm:py-8 px-3 sm:px-4">
            <IntegrationsEditor
              key={JSON.stringify(form.settings?.integrations)}
              form={form}
              onSave={(settings) => {
                save({ id: form.id, settings });
                toast.success(t("builder.integrationsSaved"));
              }}
            />
          </div>
        </div>
      )}

      {showCloudUpgrade && (
        <CloudUpgrade
          title={t("forms.publishCloudTitle")}
          description={t("forms.publishCloudDescription")}
          onClose={() => setShowCloudUpgrade(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Builder content (form editor + properties panel)
// ---------------------------------------------------------------------------

function BuilderContent({
  form,
  fields,
  selectedFieldId,
  selectedField,
  dragIdx,
  localTitle,
  localDescription,
  descriptionRef,
  titleFocused,
  descriptionFocused,
  agentPopoverOpen,
  agentPrompt,
  agentPromptRef,
  promptRun,
  canEdit,
  onTitleChange,
  onDescriptionChange,
  onSelectField,
  onUpdateField,
  onDeleteField,
  onDragStart,
  onDragOver,
  onDragEnd,
  onAddField,
  onAgentPopoverChange,
  onAgentPromptChange,
  onSubmitAgent,
}: {
  form: any;
  fields: FormField[];
  selectedFieldId: string | null;
  selectedField: FormField | undefined;
  dragIdx: number | null;
  localTitle: string;
  localDescription: string;
  descriptionRef: React.RefObject<HTMLTextAreaElement | null>;
  titleFocused: React.MutableRefObject<boolean>;
  descriptionFocused: React.MutableRefObject<boolean>;
  agentPopoverOpen: boolean;
  agentPrompt: string;
  agentPromptRef: React.RefObject<HTMLTextAreaElement | null>;
  promptRun: ReturnType<typeof useAgentPromptRun>;
  canEdit: boolean;
  onTitleChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onSelectField: (id: string | null) => void;
  onUpdateField: (f: FormField) => void;
  onDeleteField: (id: string) => void;
  onDragStart: (idx: number) => void;
  onDragOver: (e: React.DragEvent, idx: number) => void;
  onDragEnd: () => void;
  onAddField: (type: FormFieldType) => void;
  onAgentPopoverChange: (open: boolean) => void;
  onAgentPromptChange: (v: string) => void;
  onSubmitAgent: () => void;
}) {
  const t = useT();
  const fieldTypeLabels: Record<FormFieldType, string> = {
    text: t("fieldProperties.fieldTypes.text"),
    email: t("fieldProperties.fieldTypes.email"),
    number: t("fieldProperties.fieldTypes.number"),
    textarea: t("fieldProperties.fieldTypes.textarea"),
    select: t("fieldProperties.fieldTypes.select"),
    multiselect: t("fieldProperties.fieldTypes.multiselect"),
    checkbox: t("fieldProperties.fieldTypes.checkbox"),
    radio: t("builder.fieldTypeLabels.radio"),
    date: t("fieldProperties.fieldTypes.date"),
    rating: t("fieldProperties.fieldTypes.rating"),
    scale: t("fieldProperties.fieldTypes.scale"),
  };

  return (
    <div className="flex flex-1 overflow-hidden relative">
      {/* Live preview */}
      <div className="flex-1 overflow-auto bg-muted/30">
        <div className="max-w-2xl mx-auto py-4 sm:py-8 px-3 sm:px-4">
          {/* Form header */}
          <div className="mb-6">
            <Input
              value={localTitle}
              onChange={(e) => onTitleChange(e.target.value)}
              onFocus={() => (titleFocused.current = true)}
              onBlur={() => (titleFocused.current = false)}
              readOnly={!canEdit}
              className="text-2xl font-semibold border-none bg-transparent px-0 focus-visible:ring-0 h-auto"
              placeholder={t("builder.formTitlePlaceholder")}
            />
            <textarea
              ref={descriptionRef}
              value={localDescription}
              onChange={(e) => onDescriptionChange(e.target.value)}
              onFocus={() => (descriptionFocused.current = true)}
              onBlur={() => (descriptionFocused.current = false)}
              readOnly={!canEdit}
              className="mt-1 w-full text-sm text-muted-foreground bg-transparent px-0 focus-visible:outline-none resize-none overflow-hidden"
              placeholder={
                canEdit ? t("builder.addDescriptionPlaceholder") : ""
              }
              rows={1}
              style={{ minHeight: "24px", maxHeight: "120px" }}
            />
          </div>

          {/* Fields */}
          <div className="space-y-3">
            {fields.map((field, idx) =>
              canEdit ? (
                <Popover
                  key={field.id}
                  open={selectedFieldId === field.id}
                  onOpenChange={(open) => {
                    if (!open) onSelectField(null);
                  }}
                >
                  <PopoverTrigger asChild>
                    <div
                      draggable
                      onDragStart={() => onDragStart(idx)}
                      onDragOver={(e) => onDragOver(e, idx)}
                      onDragEnd={onDragEnd}
                      onClick={() =>
                        onSelectField(
                          selectedFieldId === field.id ? null : field.id,
                        )
                      }
                      className={cn(
                        "group relative rounded-lg border p-4 cursor-pointer",
                        selectedFieldId === field.id
                          ? "border-primary ring-1 ring-primary/20 bg-card"
                          : "border-border bg-card hover:border-primary/30",
                        dragIdx === idx && "opacity-50",
                      )}
                    >
                      <div
                        className="absolute -start-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 cursor-grab hidden sm:block"
                        aria-label={t("builder.dragToReorder")}
                      >
                        <IconGripVertical className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <FieldRenderer field={field} preview />
                    </div>
                  </PopoverTrigger>
                  <PopoverContent
                    side="right"
                    align="start"
                    sideOffset={12}
                    className="w-[calc(100vw-2rem)] sm:w-72 max-h-[70vh] sm:max-h-[520px] overflow-auto p-0"
                    onOpenAutoFocus={(e) => e.preventDefault()}
                    onInteractOutside={(e) => {
                      // Don't close when interacting with dropdowns portaled to body
                      const target = e.target as HTMLElement;
                      if (
                        target.closest("[data-radix-popper-content-wrapper]") ||
                        target.closest("[role='listbox']") ||
                        target.closest("[role='option']")
                      ) {
                        e.preventDefault();
                      }
                    }}
                  >
                    <FieldPropertiesPanel
                      field={field}
                      onChange={onUpdateField}
                      onDelete={() => onDeleteField(field.id)}
                    />
                  </PopoverContent>
                </Popover>
              ) : (
                <div
                  key={field.id}
                  className="relative rounded-lg border border-border bg-card p-4"
                >
                  <FieldRenderer field={field} preview />
                </div>
              ),
            )}
          </div>

          {/* Add field — only visible to editors. Viewers see a read-only
              preview of the form structure. */}
          {canEdit && (
            <div className="mt-4 flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="gap-2">
                    <IconPlus className="h-4 w-4" />
                    {t("builder.addField")}
                    <IconChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48">
                  {Object.entries(fieldTypeLabels).map(([type, label]) => (
                    <DropdownMenuItem
                      key={type}
                      onClick={() => onAddField(type as FormFieldType)}
                    >
                      {label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <Popover
                open={agentPopoverOpen}
                onOpenChange={onAgentPopoverChange}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={t("builder.editFormWithAi")}
                  >
                    <IconMessage className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  side="top"
                  align="end"
                  sideOffset={8}
                  className="w-[calc(100vw-2rem)] sm:w-80 p-0 rounded-xl"
                  onOpenAutoFocus={(e) => {
                    e.preventDefault();
                    agentPromptRef.current?.focus();
                  }}
                >
                  <div className="p-4 pb-3">
                    <p className="text-sm font-semibold">
                      {t("builder.editForm")}
                    </p>
                    <textarea
                      ref={agentPromptRef}
                      value={agentPrompt}
                      onChange={(e) => onAgentPromptChange(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                          e.preventDefault();
                          onSubmitAgent();
                        }
                      }}
                      placeholder={t("builder.agentPromptPlaceholder")}
                      rows={4}
                      className="mt-2 w-full resize-none bg-transparent text-sm placeholder:text-muted-foreground/50 focus:outline-none"
                    />
                  </div>
                  <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2.5">
                    <span className="text-[11px] text-muted-foreground/70">
                      {/Mac|iPhone|iPad/.test(navigator.userAgent)
                        ? "⌘"
                        : "Ctrl"}
                      {t("sidebar.submitShortcutSuffix")}
                    </span>
                    <Button
                      variant="secondary"
                      size="icon"
                      className="h-7 w-7"
                      onClick={onSubmitAgent}
                      disabled={
                        !agentPrompt.trim() ||
                        promptRun.isActivePrompt(agentPrompt)
                      }
                      aria-label={t("sidebar.sendPrompt")}
                    >
                      <IconArrowUp className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results content (responses table)
// ---------------------------------------------------------------------------

function responseValueAsString(val: unknown): string {
  if (val === undefined || val === null) return "";
  if (Array.isArray(val)) return val.join(", ");
  return String(val);
}

function compareResponseValues(a: unknown, b: unknown): number {
  const aText = responseValueAsString(a);
  const bText = responseValueAsString(b);
  const aEmpty = !aText;
  const bEmpty = !bText;
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  const aNum = Number(aText);
  const bNum = Number(bText);
  if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) return aNum - bNum;

  return aText.localeCompare(bText, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function ResultsContent({ formId, form }: { formId: string; form: any }) {
  const t = useT();
  const { formatNumber } = useFormatters();
  const { data, isLoading, error, refetch } = useFormResponses(formId);
  const [search, setSearch] = useState("");
  // `_submitted` is the synthetic Submitted column. Field columns sort by id.
  const [sortKey, setSortKey] = useState<string>("_submitted");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "_submitted" ? "desc" : "asc");
    }
  }

  const allResponses = data?.responses || [];
  const fields: FormField[] = data?.fields || form?.fields || [];
  const total = data?.total ?? 0;
  const hasSubmitterEmail = allResponses.some((r: any) =>
    responseValueAsString(r.submitterEmail).trim(),
  );
  const responseTableMinWidth =
    64 + 160 + (hasSubmitterEmail ? 224 : 0) + Math.max(fields.length, 1) * 320;

  const filtered = search.trim()
    ? allResponses.filter((r: any) => {
        const needle = search.trim().toLowerCase();
        if (
          responseValueAsString(r.submitterEmail).toLowerCase().includes(needle)
        ) {
          return true;
        }
        return fields.some((f) => {
          return responseValueAsString(r.data[f.id])
            .toLowerCase()
            .includes(needle);
        });
      })
    : allResponses;

  const responses = [...filtered].sort((a, b) => {
    let cmp: number;
    if (sortKey === "_submitted") {
      cmp =
        new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime();
    } else if (sortKey === "_email") {
      cmp = compareResponseValues(a.submitterEmail, b.submitterEmail);
    } else {
      cmp = compareResponseValues(a.data[sortKey], b.data[sortKey]);
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  function exportCsv() {
    if (!fields.length || !responses.length) return;
    const headers = [
      t("builder.results.submittedAt"),
      ...(hasSubmitterEmail ? [t("builder.results.submitterEmail")] : []),
      ...fields.map((f) => f.label),
    ];
    const rows = responses.map((r) => [
      r.submittedAt,
      ...(hasSubmitterEmail ? [responseValueAsString(r.submitterEmail)] : []),
      ...fields.map((f) => responseValueAsString(r.data[f.id])),
    ]);

    const csv = [headers, ...rows]
      .map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
      )
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${form?.title || t("builder.results.responsesFilename")}-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (isLoading) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden">
        <div className="flex items-center justify-between px-3 sm:px-4 py-2 border-b border-border">
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
        <div className="flex-1 overflow-auto">
          <div className="border-b border-border bg-muted/30 px-3 sm:px-4 py-2 flex gap-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-28" />
          </div>
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="border-b border-border px-3 sm:px-4 py-3 flex gap-4 items-center"
            >
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-40" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error && !responses.length) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-3">
        <p className="text-sm text-muted-foreground">
          {t("responses.failedLoad")}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          className="gap-2"
        >
          <IconRefresh className="h-3.5 w-3.5" />
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  if (allResponses.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 py-20">
        <h3 className="font-medium mb-1">{t("responses.emptyTitle")}</h3>
        <p className="text-sm text-muted-foreground">
          {t("responses.emptyDescription")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            {t("builder.results.responseCount", {
              count: total,
              formattedCount: formatNumber(total),
            })}
          </Badge>
          {search.trim() && filtered.length !== allResponses.length && (
            <span className="text-xs text-muted-foreground">
              {t("builder.results.matchCount", {
                count: filtered.length,
                formattedCount: formatNumber(filtered.length),
              })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <IconSearch className="absolute start-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              type="search"
              placeholder={t("builder.results.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 ps-7 text-xs w-44 sm:w-56"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={exportCsv}
          >
            <IconDownload className="h-3.5 w-3.5" />
            {t("responses.exportCsv")}
          </Button>
        </div>
      </div>
      <div className="flex-1 min-w-0 overflow-auto overscroll-x-contain">
        <div className="min-w-full">
          <table
            className="min-w-full table-fixed text-sm"
            style={{ minWidth: responseTableMinWidth }}
          >
            <colgroup>
              <col className="w-16" />
              <col className="w-40" />
              {hasSubmitterEmail ? <col className="w-56" /> : null}
              {fields.map((f) => (
                <col key={f.id} className="w-80" />
              ))}
            </colgroup>
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th
                  scope="col"
                  className="min-w-16 px-4 py-2.5 text-start text-xs font-medium text-muted-foreground whitespace-nowrap"
                >
                  #
                </th>
                <th
                  scope="col"
                  className="min-w-36 px-4 py-2.5 text-start text-xs font-medium text-muted-foreground whitespace-nowrap"
                >
                  <ResultsSortableHeader
                    label={t("responses.submitted")}
                    active={sortKey === "_submitted"}
                    dir={sortDir}
                    onClick={() => toggleSort("_submitted")}
                  />
                </th>
                {hasSubmitterEmail && (
                  <th
                    scope="col"
                    className="px-4 py-2.5 text-start text-xs font-medium text-muted-foreground whitespace-nowrap"
                  >
                    <ResultsSortableHeader
                      label={t("responses.email")}
                      active={sortKey === "_email"}
                      dir={sortDir}
                      onClick={() => toggleSort("_email")}
                    />
                  </th>
                )}
                {fields.map((f) => (
                  <th
                    key={f.id}
                    scope="col"
                    className="px-4 py-2.5 text-start text-xs font-medium text-muted-foreground whitespace-nowrap"
                  >
                    <ResultsSortableHeader
                      label={f.label}
                      active={sortKey === f.id}
                      dir={sortDir}
                      onClick={() => toggleSort(f.id)}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {responses.length === 0 && (
                <tr>
                  <td
                    colSpan={2 + (hasSubmitterEmail ? 1 : 0) + fields.length}
                    className="px-4 py-8 text-center text-xs text-muted-foreground"
                  >
                    {t("builder.results.noSearchMatches")}
                  </td>
                </tr>
              )}
              {responses.map((response, idx) => (
                <tr
                  key={response.id}
                  className="border-b border-border hover:bg-muted/20"
                >
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {responses.length - idx}
                  </td>
                  <td className="min-w-36 px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(response.submittedAt), "MMM d, h:mm a")}
                  </td>
                  {hasSubmitterEmail && (
                    <td className="px-4 py-3 align-top text-xs text-muted-foreground whitespace-normal break-words">
                      {responseValueAsString(response.submitterEmail) || "-"}
                    </td>
                  )}
                  {fields.map((f) => {
                    const val = response.data[f.id];
                    const display = responseValueAsString(val) || "-";
                    return (
                      <td
                        key={f.id}
                        className="min-w-48 px-4 py-3 align-top text-xs leading-5 whitespace-pre-wrap break-words"
                        title={display}
                      >
                        {display}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ResultsSortableHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer"
    >
      <span>{label}</span>
      {active ? (
        dir === "asc" ? (
          <IconArrowUp className="h-3 w-3" />
        ) : (
          <IconArrowDown className="h-3 w-3" />
        )
      ) : (
        <IconArrowsSort className="h-3 w-3 opacity-40" />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Settings editor (general settings)
// ---------------------------------------------------------------------------

function SettingsEditor({
  form,
  onSave,
}: {
  form: { settings: FormSettings };
  onSave: (settings: FormSettings) => void;
}) {
  const t = useT();
  const [settings, setSettings] = useState<FormSettings>({ ...form.settings });

  function update(partial: Partial<FormSettings>) {
    setSettings((prev) => ({ ...prev, ...partial }));
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-xs">
          {t("builder.settings.submitButtonText")}
        </Label>
        <Input
          value={settings.submitText || t("builder.settings.defaultSubmitText")}
          onChange={(e) => update({ submitText: e.target.value })}
          className="h-8 text-sm"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs">
          {t("builder.settings.successMessage")}
        </Label>
        <Textarea
          value={
            settings.successMessage ||
            t("builder.settings.defaultSuccessMessage")
          }
          onChange={(e) => update({ successMessage: e.target.value })}
          rows={2}
          className="text-sm"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs">{t("builder.settings.redirectUrl")}</Label>
        <Input
          value={settings.redirectUrl || ""}
          onChange={(e) => update({ redirectUrl: e.target.value })}
          placeholder="https://..."
          className="h-8 text-sm"
        />
      </div>

      <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
        <div className="space-y-1">
          <Label htmlFor="anonymous-responses" className="text-xs">
            {t("builder.settings.anonymousResponses")}
          </Label>
          <p className="text-xs leading-5 text-muted-foreground">
            {t("builder.settings.anonymousResponsesDescription")}
          </p>
        </div>
        <Switch
          id="anonymous-responses"
          checked={settings.anonymous === true}
          onCheckedChange={(anonymous) => update({ anonymous })}
          aria-label={t("builder.settings.anonymousResponses")}
        />
      </div>

      <Button onClick={() => onSave(settings)} className="w-full" size="sm">
        {t("builder.settings.saveSettings")}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Integrations editor
// ---------------------------------------------------------------------------

const integrationMeta: Record<
  IntegrationType,
  {
    labelKey: string;
    icon: typeof IconWebhook;
    logoSrc?: string;
    placeholder: string;
    blurbKey: string;
    helpKey: string;
  }
> = {
  slack: {
    labelKey: "builder.integrations.slackLabel",
    icon: IconHash,
    logoSrc: "/brands/slack.svg",
    placeholder: "https://hooks.slack.com/services/...",
    blurbKey: "builder.integrations.slackBlurb",
    helpKey: "builder.integrations.slackHelp",
  },
  discord: {
    labelKey: "builder.integrations.discordLabel",
    icon: IconHash,
    logoSrc: "/brands/discord.svg",
    placeholder: "https://discord.com/api/webhooks/...",
    blurbKey: "builder.integrations.discordBlurb",
    helpKey: "builder.integrations.discordHelp",
  },
  webhook: {
    labelKey: "builder.integrations.webhookLabel",
    icon: IconWebhook,
    placeholder: "https://...",
    blurbKey: "builder.integrations.webhookBlurb",
    helpKey: "builder.integrations.webhookHelp",
  },
  "google-sheets": {
    labelKey: "builder.integrations.googleSheetsLabel",
    icon: IconGlobe,
    logoSrc: "/brands/google-sheets.svg",
    placeholder: "https://script.google.com/macros/s/.../exec",
    blurbKey: "builder.integrations.googleSheetsBlurb",
    helpKey: "builder.integrations.googleSheetsHelp",
  },
};

function IntegrationBrandMark({
  type,
  className,
}: {
  type: IntegrationType;
  className?: string;
}) {
  const t = useT();
  const meta = integrationMeta[type];
  const label = t(meta.labelKey);
  const Icon = meta.icon;

  if (meta.logoSrc) {
    return (
      <div
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-xl border border-border/70 bg-background shadow-sm",
          className,
        )}
      >
        <img
          src={meta.logoSrc}
          alt={t("builder.integrations.logoAlt", { label })}
          className="h-5 w-5 object-contain"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex h-10 w-10 items-center justify-center rounded-xl border border-border/70 bg-foreground text-background shadow-sm",
        className,
      )}
    >
      <Icon className="h-5 w-5" />
    </div>
  );
}

function IntegrationsEditor({
  form,
  onSave,
}: {
  form: { settings: FormSettings };
  onSave: (settings: FormSettings) => void;
}) {
  const t = useT();
  const [settings, setSettings] = useState<FormSettings>({ ...form.settings });
  const integrations = settings.integrations ?? [];
  const selectedTypes = new Set(
    integrations.map((integration) => integration.type),
  );
  const hasIntegrations = integrations.length > 0;
  const configuredCount = integrations.filter((integration) =>
    integration.url.trim(),
  ).length;

  function update(partial: Partial<FormSettings>) {
    setSettings((prev) => ({ ...prev, ...partial }));
  }

  function addIntegration(type: IntegrationType) {
    const meta = integrationMeta[type];
    const integration: FormIntegration = {
      id: nanoid(8),
      type,
      name: t(meta.labelKey),
      enabled: true,
      url: "",
    };
    update({
      integrations: [...(settings.integrations ?? []), integration],
    });
  }

  function updateIntegration(id: string, partial: Partial<FormIntegration>) {
    update({
      integrations: (settings.integrations ?? []).map((i) =>
        i.id === id ? { ...i, ...partial } : i,
      ),
    });
  }

  function removeIntegration(id: string) {
    update({
      integrations: (settings.integrations ?? []).filter((i) => i.id !== id),
    });
  }

  const saveLabel = hasIntegrations
    ? t("builder.integrations.saveIntegration", {
        count: integrations.length,
      })
    : t("builder.integrations.chooseIntegrationFirst");

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground/70">
          {t("builder.integrations.automations")}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("builder.integrations.description")}
        </p>
      </div>

      {!hasIntegrations && (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-5">
          <div className="space-y-4">
            <div className="space-y-2">
              <h3 className="text-sm font-medium">
                {t("builder.integrations.addFirstIntegration")}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t("builder.integrations.emptyDescription")}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(
                Object.entries(integrationMeta) as [
                  IntegrationType,
                  (typeof integrationMeta)[IntegrationType],
                ][]
              ).map(([type, meta]) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => addIntegration(type)}
                  className="cursor-pointer rounded-lg border bg-background p-3 text-start hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-h-[44px]"
                >
                  <div className="flex items-center gap-3">
                    <IntegrationBrandMark type={type} className="h-9 w-9" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {t(meta.labelKey)}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {type === "webhook"
                          ? t("builder.integrations.customEndpoint")
                          : t("builder.integrations.builtInOption")}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <p className="text-xs text-muted-foreground">
              {t("builder.integrations.addMoreHint")}
            </p>
          </div>
        </div>
      )}

      {integrations.map((integration) => {
        const meta = integrationMeta[integration.type];
        const integrationLabel = t(meta.labelKey);
        return (
          <div
            key={integration.id}
            className="rounded-xl border bg-card p-4 space-y-3"
          >
            <div className="flex items-start gap-3">
              <IntegrationBrandMark type={integration.type} />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold">{integrationLabel}</p>
                  <Badge
                    variant="secondary"
                    className={cn(
                      "rounded-full px-2 py-0 text-[10px]",
                      integration.enabled
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : "text-muted-foreground",
                    )}
                  >
                    {integration.enabled
                      ? t("builder.integrations.enabled")
                      : t("builder.integrations.paused")}
                  </Badge>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  {t(meta.blurbKey)}
                </p>
              </div>
              <Switch
                checked={integration.enabled}
                onCheckedChange={(checked) =>
                  updateIntegration(integration.id, { enabled: checked })
                }
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => removeIntegration(integration.id)}
              >
                <IconTrash className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-2">
              <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70">
                {t("fieldProperties.label")}
              </Label>
              <Input
                value={integration.name}
                onChange={(e) =>
                  updateIntegration(integration.id, {
                    name: e.target.value,
                  })
                }
                className="h-9 text-sm font-medium"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70">
                {t("builder.integrations.destinationUrl")}
              </Label>
              <Input
                value={integration.url}
                onChange={(e) =>
                  updateIntegration(integration.id, { url: e.target.value })
                }
                placeholder={meta.placeholder}
                className="h-9 text-sm font-mono"
              />
            </div>

            <p className="text-[11px] text-muted-foreground">
              {t(meta.helpKey)}
            </p>
          </div>
        );
      })}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-11 w-full rounded-xl"
          >
            <IconPlus className="h-3.5 w-3.5 me-1.5" />
            {hasIntegrations
              ? t("builder.integrations.addAnotherIntegration")
              : t("builder.integrations.addIntegration")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-80 p-1.5">
          {(
            Object.entries(integrationMeta) as [
              IntegrationType,
              (typeof integrationMeta)[IntegrationType],
            ][]
          ).map(([type, meta]) => {
            return (
              <DropdownMenuItem
                key={type}
                onClick={() => addIntegration(type)}
                disabled={selectedTypes.has(type)}
                className="rounded-md px-3 py-3"
              >
                <div className="flex items-center gap-3">
                  <IntegrationBrandMark type={type} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{t(meta.labelKey)}</p>
                      {selectedTypes.has(type) && (
                        <Badge
                          variant="secondary"
                          className="px-2 py-0 text-[10px]"
                        >
                          {t("builder.integrations.added")}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                      {t(meta.blurbKey)}
                    </p>
                  </div>
                </div>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {hasIntegrations && (
        <div className="space-y-2">
          <Button
            onClick={() => onSave(settings)}
            className="h-10 w-full"
            size="sm"
          >
            {saveLabel}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            {configuredCount === integrations.length
              ? t("builder.integrations.readyHint")
              : t("builder.integrations.partialSetupHint")}
          </p>
        </div>
      )}
    </div>
  );
}
