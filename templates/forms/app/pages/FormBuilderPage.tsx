import { useState, useCallback, useRef, useEffect } from "react";
import { useParams, useNavigate } from "react-router";
import { nanoid } from "nanoid";
import {
  IconShare,
  IconExternalLink,
  IconCheck,
  IconGripVertical,
  IconPlus,
  IconChevronDown,
  IconCopy,
  IconArrowUp,
  IconMessageCircle,
  IconGlobe,
  IconHash,
  IconTrash,
  IconWebhook,
  IconDownload,
  IconRefresh,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FieldRenderer } from "@/components/builder/FieldRenderer";
import { FieldPropertiesPanel } from "@/components/builder/FieldPropertiesPanel";
import { useForm, useUpdateForm } from "@/hooks/use-forms";
import { useFormResponses } from "@/hooks/use-responses";
import { useDbStatus } from "@/hooks/use-db-status";
import { CloudUpgrade } from "@/components/CloudUpgrade";
import {
  AgentToggleButton,
  useSendToAgentChat,
} from "@agent-native/core/client";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from "date-fns";
import type {
  FormField,
  FormFieldType,
  FormIntegration,
  FormSettings,
  IntegrationType,
} from "@shared/types";

const fieldTypeDefaults: Record<FormFieldType, Partial<FormField>> = {
  text: { label: "Text Field", placeholder: "Enter text..." },
  email: { label: "Email", placeholder: "you@example.com" },
  number: { label: "Number", placeholder: "0" },
  textarea: { label: "Long Answer", placeholder: "Type your answer..." },
  select: { label: "Dropdown", options: ["Option 1", "Option 2", "Option 3"] },
  multiselect: {
    label: "Multi-select",
    options: ["Option 1", "Option 2", "Option 3"],
  },
  checkbox: { label: "Checkbox" },
  radio: {
    label: "Multiple Choice",
    options: ["Option 1", "Option 2", "Option 3"],
  },
  date: { label: "Date" },
  rating: { label: "Rating" },
  scale: { label: "Scale", validation: { min: 1, max: 10 } },
};

const fieldTypeLabels: Record<FormFieldType, string> = {
  text: "Short Text",
  email: "Email",
  number: "Number",
  textarea: "Long Text",
  select: "Dropdown",
  multiselect: "Multi-select",
  checkbox: "Checkbox",
  radio: "Multiple Choice",
  date: "Date",
  rating: "Rating",
  scale: "Scale",
};

export function FormBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: form, isLoading, error, refetch } = useForm(id!);
  const updateForm = useUpdateForm();

  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("edit");
  const [copied, setCopied] = useState(false);
  const { isLocal } = useDbStatus();
  const [showCloudUpgrade, setShowCloudUpgrade] = useState(false);
  const [agentPopoverOpen, setAgentPopoverOpen] = useState(false);
  const [agentPrompt, setAgentPrompt] = useState("");
  const agentPromptRef = useRef<HTMLTextAreaElement>(null);
  const { send, codeRequiredDialog } = useSendToAgentChat();
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  // Local state for text inputs and fields — prevents polling-driven refetches
  // from resetting input values while the user is typing or losing optimistic
  // updates (e.g. newly added fields).
  const [localTitle, setLocalTitle] = useState(form?.title ?? "");
  const [localDescription, setLocalDescription] = useState(
    form?.description ?? "",
  );
  const [localFields, setLocalFields] = useState<FormField[]>(
    form?.fields || [],
  );
  const titleFocused = useRef(false);
  const titleMeasureRef = useRef<HTMLSpanElement>(null);
  const [titleInputWidth, setTitleInputWidth] = useState<number | undefined>();
  const descriptionFocused = useRef(false);
  const fieldsDirty = useRef(false);

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

  // Sync from server when not dirty (e.g. agent updates the fields)
  useEffect(() => {
    if (form && !titleFocused.current) setLocalTitle(form.title);
  }, [form?.title]);
  useEffect(() => {
    if (form && !descriptionFocused.current)
      setLocalDescription(form.description || "");
  }, [form?.description]);
  useEffect(() => {
    if (form && !fieldsDirty.current) setLocalFields(form.fields || []);
  }, [form?.fields]);

  // Auto-grow description textarea
  useEffect(() => {
    const el = descriptionRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }
  }, [localDescription]);

  // Debounced save
  const saveTimeout = useRef<ReturnType<typeof setTimeout>>();
  const savedTimeout = useRef<ReturnType<typeof setTimeout>>();
  const save = useCallback(
    (data: Parameters<typeof updateForm.mutate>[0]) => {
      clearTimeout(saveTimeout.current);
      clearTimeout(savedTimeout.current);
      setSaveState("saving");
      saveTimeout.current = setTimeout(() => {
        updateForm.mutate(data, {
          onSettled: () => {
            fieldsDirty.current = false;
          },
          onSuccess: () => {
            setSaveState("saved");
            savedTimeout.current = setTimeout(() => setSaveState("idle"), 2000);
          },
          onError: () => {
            setSaveState("idle");
          },
        });
      }, 500);
    },
    [updateForm],
  );

  useEffect(
    () => () => {
      clearTimeout(saveTimeout.current);
      clearTimeout(savedTimeout.current);
    },
    [],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (error && !form) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm text-muted-foreground">Failed to load form</p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/forms")}
          >
            Back to Forms
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const fields = localFields;
  const selectedField = fields.find((f) => f.id === selectedFieldId);

  function updateFields(newFields: FormField[]) {
    setLocalFields(newFields);
    fieldsDirty.current = true;
    save({ id: form.id, fields: newFields });
  }

  function addField(type: FormFieldType) {
    const defaults = fieldTypeDefaults[type] || {};
    const newField: FormField = {
      id: nanoid(8),
      type,
      label: defaults.label || "New Field",
      placeholder: defaults.placeholder,
      required: false,
      options: defaults.options,
      validation: defaults.validation,
      width: "full",
    };
    const newFields = [...fields, newField];
    updateFields(newFields);
    setSelectedFieldId(newField.id);
  }

  function updateField(updated: FormField) {
    const newFields = fields.map((f) => (f.id === updated.id ? updated : f));
    updateFields(newFields);
  }

  function deleteField(fieldId: string) {
    const newFields = fields.filter((f) => f.id !== fieldId);
    updateFields(newFields);
    if (selectedFieldId === fieldId) setSelectedFieldId(null);
  }

  function moveField(from: number, to: number) {
    const newFields = [...fields];
    const [moved] = newFields.splice(from, 1);
    newFields.splice(to, 0, moved);
    updateFields(newFields);
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
    if (!agentPrompt.trim()) return;
    const context = `Current form:\nTitle: ${form.title}\nDescription: ${form.description || "None"}\nFields: ${JSON.stringify(fields, null, 2)}`;
    const result = send({ message: agentPrompt.trim(), context, submit: true });
    if (result === null) return;
    setAgentPopoverOpen(false);
    setAgentPrompt("");
  }

  function handleTogglePublish() {
    const newStatus = form.status === "published" ? "draft" : "published";
    if (newStatus === "published" && isLocal) {
      setShowCloudUpgrade(true);
      return;
    }
    updateForm.mutate(
      { id: form.id, status: newStatus },
      {
        onSuccess: () =>
          toast.success(
            newStatus === "published" ? "Form published!" : "Form unpublished",
          ),
      },
    );
  }

  function copyShareLink() {
    if (isLocal) {
      setShowCloudUpgrade(true);
      return;
    }
    const url = `${window.location.origin}/f/${form.slug}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Link copied to clipboard");
  }

  return (
    <div className="flex flex-col h-full">
      {codeRequiredDialog}
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-border px-4 h-14 shrink-0">
        <div className="flex items-center gap-3 relative">
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
            className="h-8 text-sm font-medium border-none bg-transparent px-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 max-w-80"
          />
          <Badge
            variant="outline"
            className={cn(
              "text-[10px]",
              form.status === "published"
                ? "bg-emerald-600/10 text-emerald-600 border-emerald-600/20"
                : "bg-amber-600/10 text-amber-600 border-amber-600/20",
            )}
          >
            {form.status}
          </Badge>
          {saveState !== "idle" && (
            <span className="text-[11px] text-muted-foreground">
              {saveState === "saving" ? "Saving…" : "Saved"}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {form.status === "published" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                  <a href={`/f/${form.slug}`} target="_blank" rel="noopener">
                    <IconExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Preview</TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={copyShareLink}
              >
                {copied ? (
                  <IconCheck className="h-4 w-4" />
                ) : (
                  <IconShare className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{copied ? "Copied!" : "Share"}</TooltipContent>
          </Tooltip>

          <Button size="sm" className="text-xs" onClick={handleTogglePublish}>
            {form.status === "published" ? "Unpublish" : "Publish"}
          </Button>
          <AgentToggleButton />
        </div>
      </div>

      {/* Tab row */}
      <div className="border-b border-border px-4 shrink-0">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="h-9 bg-transparent p-0 gap-0">
            <TabsTrigger
              value="edit"
              className="text-xs px-3 h-9 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              Edit
            </TabsTrigger>
            <TabsTrigger
              value="results"
              className="text-xs px-3 h-9 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              Results
              {(form.responseCount ?? 0) > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-1.5 text-[9px] px-1 py-0 h-4 min-w-4"
                >
                  {form.responseCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="settings"
              className="text-xs px-3 h-9 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              Settings
            </TabsTrigger>
            <TabsTrigger
              value="integrations"
              className="text-xs px-3 h-9 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              Integrations
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Tab content */}
      {activeTab === "edit" && (
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

      {activeTab === "results" && (
        <ResultsContent formId={form.id} form={form} />
      )}

      {activeTab === "settings" && (
        <div className="flex-1 overflow-auto">
          <div className="max-w-lg mx-auto py-8 px-4">
            <SettingsEditor
              form={form}
              onSave={(settings) => {
                save({ id: form.id, settings });
                toast.success("Settings saved");
              }}
            />
          </div>
        </div>
      )}

      {activeTab === "integrations" && (
        <div className="flex-1 overflow-auto">
          <div className="max-w-lg mx-auto py-8 px-4">
            <IntegrationsEditor
              form={form}
              onSave={(settings) => {
                save({ id: form.id, settings });
                toast.success("Integrations saved");
              }}
            />
          </div>
        </div>
      )}

      {showCloudUpgrade && (
        <CloudUpgrade
          title="Publish Form"
          description="To publish forms publicly, connect a cloud database so submissions can be received from anywhere."
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
  return (
    <div className="flex flex-1 overflow-hidden relative">
      {/* Live preview */}
      <div className="flex-1 overflow-auto bg-muted/30">
        <div className="max-w-2xl mx-auto py-8 px-4">
          {/* Form header */}
          <div className="mb-6">
            <Input
              value={localTitle}
              onChange={(e) => onTitleChange(e.target.value)}
              onFocus={() => (titleFocused.current = true)}
              onBlur={() => (titleFocused.current = false)}
              className="text-2xl font-semibold border-none bg-transparent px-0 focus-visible:ring-0 h-auto"
              placeholder="Form Title"
            />
            <textarea
              ref={descriptionRef}
              value={localDescription}
              onChange={(e) => onDescriptionChange(e.target.value)}
              onFocus={() => (descriptionFocused.current = true)}
              onBlur={() => (descriptionFocused.current = false)}
              className="mt-1 w-full text-sm text-muted-foreground bg-transparent px-0 focus-visible:outline-none resize-none overflow-hidden"
              placeholder="Add a description..."
              rows={1}
              style={{ minHeight: "24px", maxHeight: "120px" }}
            />
          </div>

          {/* Fields */}
          <div className="space-y-3">
            {fields.map((field, idx) => (
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
                      className="absolute -left-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 cursor-grab"
                      aria-label="Drag to reorder"
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
                  className="w-72 max-h-[520px] overflow-auto p-0"
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
            ))}
          </div>

          {/* Add field */}
          <div className="mt-4 flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <IconPlus className="h-4 w-4" />
                  Add Field
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
                  aria-label="Edit form with AI"
                >
                  <IconMessageCircle className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                side="top"
                align="end"
                sideOffset={8}
                className="w-80 p-0 rounded-xl"
                onOpenAutoFocus={(e) => {
                  e.preventDefault();
                  agentPromptRef.current?.focus();
                }}
              >
                <div className="p-4 pb-3">
                  <p className="text-sm font-semibold">Edit form</p>
                  <textarea
                    ref={agentPromptRef}
                    value={agentPrompt}
                    onChange={(e) => onAgentPromptChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        onSubmitAgent();
                      }
                    }}
                    placeholder="Add missing fields, change the layout..."
                    rows={4}
                    className="mt-2 w-full resize-none bg-transparent text-sm placeholder:text-muted-foreground/50 focus:outline-none"
                  />
                </div>
                <div className="flex items-center justify-end border-t border-border px-4 py-2.5">
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-7 w-7"
                    onClick={onSubmitAgent}
                    disabled={!agentPrompt.trim()}
                    aria-label="Send prompt"
                  >
                    <IconArrowUp className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results content (responses table)
// ---------------------------------------------------------------------------

function ResultsContent({ formId, form }: { formId: string; form: any }) {
  const { data, isLoading, error, refetch } = useFormResponses(formId);

  const responses = data?.responses || [];
  const fields: FormField[] = data?.fields || form?.fields || [];
  const total = data?.total ?? 0;

  function exportCsv() {
    if (!fields.length || !responses.length) return;
    const headers = ["Submitted At", ...fields.map((f) => f.label)];
    const rows = responses.map((r) => [
      r.submittedAt,
      ...fields.map((f) => {
        const val = r.data[f.id];
        if (Array.isArray(val)) return val.join(", ");
        return String(val ?? "");
      }),
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
    a.download = `${form?.title || "responses"}-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center flex-1">
        <p className="text-muted-foreground">Loading responses...</p>
      </div>
    );
  }

  if (error && !responses.length) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-3">
        <p className="text-sm text-muted-foreground">
          Failed to load responses
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          className="gap-2"
        >
          <IconRefresh className="h-3.5 w-3.5" />
          Retry
        </Button>
      </div>
    );
  }

  if (responses.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 py-20">
        <h3 className="font-medium mb-1">No responses yet</h3>
        <p className="text-sm text-muted-foreground">
          Share your form to start collecting responses
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <Badge variant="secondary" className="text-xs">
          {total} response{total !== 1 ? "s" : ""}
        </Badge>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={exportCsv}
        >
          <IconDownload className="h-3.5 w-3.5" />
          Export CSV
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="min-w-max">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th
                  scope="col"
                  className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap"
                >
                  #
                </th>
                <th
                  scope="col"
                  className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap"
                >
                  Submitted
                </th>
                {fields.map((f) => (
                  <th
                    key={f.id}
                    scope="col"
                    className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap"
                  >
                    {f.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {responses.map((response, idx) => (
                <tr
                  key={response.id}
                  className="border-b border-border hover:bg-muted/20"
                >
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {total - idx}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(response.submittedAt), "MMM d, h:mm a")}
                  </td>
                  {fields.map((f) => {
                    const val = response.data[f.id];
                    let display: string;
                    if (val === undefined || val === null) {
                      display = "-";
                    } else if (Array.isArray(val)) {
                      display = val.join(", ");
                    } else {
                      display = String(val);
                    }
                    return (
                      <td
                        key={f.id}
                        className="px-4 py-2.5 text-xs max-w-[200px] truncate"
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
      </ScrollArea>
    </div>
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
  const [settings, setSettings] = useState<FormSettings>({ ...form.settings });

  function update(partial: Partial<FormSettings>) {
    setSettings((prev) => ({ ...prev, ...partial }));
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-xs">Submit button text</Label>
        <Input
          value={settings.submitText || "Submit"}
          onChange={(e) => update({ submitText: e.target.value })}
          className="h-8 text-sm"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Success message</Label>
        <Textarea
          value={
            settings.successMessage ||
            "Thank you! Your response has been recorded."
          }
          onChange={(e) => update({ successMessage: e.target.value })}
          rows={2}
          className="text-sm"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Redirect URL (optional)</Label>
        <Input
          value={settings.redirectUrl || ""}
          onChange={(e) => update({ redirectUrl: e.target.value })}
          placeholder="https://..."
          className="h-8 text-sm"
        />
      </div>

      <Separator />

      <div className="space-y-2">
        <Label className="text-xs">Primary color</Label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={settings.primaryColor || "#334155"}
            onChange={(e) => update({ primaryColor: e.target.value })}
            className="h-8 w-8 rounded border border-border cursor-pointer"
          />
          <Input
            value={settings.primaryColor || "#334155"}
            onChange={(e) => update({ primaryColor: e.target.value })}
            className="h-8 text-sm flex-1"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Font family</Label>
        <Input
          value={settings.fontFamily || "Inter"}
          onChange={(e) => update({ fontFamily: e.target.value })}
          className="h-8 text-sm"
        />
      </div>

      <Button onClick={() => onSave(settings)} className="w-full" size="sm">
        Save Settings
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
    label: string;
    icon: typeof IconWebhook;
    placeholder: string;
    help: string;
  }
> = {
  slack: {
    label: "Slack",
    icon: IconHash,
    placeholder: "https://hooks.slack.com/services/...",
    help: "Create an Incoming Webhook in your Slack app settings",
  },
  discord: {
    label: "Discord",
    icon: IconHash,
    placeholder: "https://discord.com/api/webhooks/...",
    help: "Channel Settings > Integrations > Webhooks",
  },
  webhook: {
    label: "Webhook",
    icon: IconWebhook,
    placeholder: "https://...",
    help: "Sends a JSON POST with submission data. Works with Zapier, Make, n8n, etc.",
  },
  "google-sheets": {
    label: "Google Sheets",
    icon: IconGlobe,
    placeholder: "https://script.google.com/macros/s/.../exec",
    help: "Deploy an Apps Script web app that receives POST data",
  },
};

function IntegrationsEditor({
  form,
  onSave,
}: {
  form: { settings: FormSettings };
  onSave: (settings: FormSettings) => void;
}) {
  const [settings, setSettings] = useState<FormSettings>({ ...form.settings });

  function update(partial: Partial<FormSettings>) {
    setSettings((prev) => ({ ...prev, ...partial }));
  }

  function addIntegration(type: IntegrationType) {
    const meta = integrationMeta[type];
    const integration: FormIntegration = {
      id: nanoid(8),
      type,
      name: meta.label,
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

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Send form submissions to external services automatically.
      </p>

      {(settings.integrations ?? []).map((integration) => {
        const meta = integrationMeta[integration.type];
        const Icon = meta.icon;
        return (
          <div
            key={integration.id}
            className="rounded-lg border border-border p-3 space-y-2.5"
          >
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
              <Input
                value={integration.name}
                onChange={(e) =>
                  updateIntegration(integration.id, {
                    name: e.target.value,
                  })
                }
                className="h-7 text-sm font-medium flex-1"
              />
              <Switch
                checked={integration.enabled}
                onCheckedChange={(checked) =>
                  updateIntegration(integration.id, { enabled: checked })
                }
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => removeIntegration(integration.id)}
              >
                <IconTrash className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Input
              value={integration.url}
              onChange={(e) =>
                updateIntegration(integration.id, { url: e.target.value })
              }
              placeholder={meta.placeholder}
              className="h-8 text-sm font-mono"
            />
            <p className="text-[11px] text-muted-foreground">{meta.help}</p>
          </div>
        );
      })}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="w-full">
            <IconPlus className="h-3.5 w-3.5 mr-1.5" />
            Add Integration
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-56">
          {(
            Object.entries(integrationMeta) as [
              IntegrationType,
              (typeof integrationMeta)[IntegrationType],
            ][]
          ).map(([type, meta]) => {
            const Icon = meta.icon;
            return (
              <DropdownMenuItem key={type} onClick={() => addIntegration(type)}>
                <Icon className="h-4 w-4 mr-2" />
                {meta.label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button onClick={() => onSave(settings)} className="w-full" size="sm">
        Save Integrations
      </Button>
    </div>
  );
}
