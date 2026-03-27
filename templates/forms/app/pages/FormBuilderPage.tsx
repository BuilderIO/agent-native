import { useState, useCallback, useRef, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router";
import { nanoid } from "nanoid";
import {
  Settings,
  Share2,
  Eye,
  BarChart3,
  GripVertical,
  Plus,
  ChevronDown,
  ExternalLink,
  Copy,
  Check,
  ArrowUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FieldRenderer } from "@/components/builder/FieldRenderer";
import { FieldPropertiesPanel } from "@/components/builder/FieldPropertiesPanel";
import { useForm, useUpdateForm } from "@/hooks/use-forms";
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
import type { FormField, FormFieldType, FormSettings } from "@shared/types";

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
  const { data: form, isLoading } = useForm(id!);
  const updateForm = useUpdateForm();

  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { isLocal } = useDbStatus();
  const [showCloudUpgrade, setShowCloudUpgrade] = useState(false);
  const [agentPopoverOpen, setAgentPopoverOpen] = useState(false);
  const [agentPrompt, setAgentPrompt] = useState("");
  const agentPromptRef = useRef<HTMLTextAreaElement>(null);
  const { send, codeRequiredDialog } = useSendToAgentChat();

  // Local state for text inputs — prevents polling-driven refetches from
  // resetting input values while the user is typing.
  const [localTitle, setLocalTitle] = useState(form?.title ?? "");
  const [localDescription, setLocalDescription] = useState(
    form?.description ?? "",
  );
  const titleFocused = useRef(false);
  const descriptionFocused = useRef(false);

  // Sync from server when not focused (e.g. agent updates the title)
  useEffect(() => {
    if (form && !titleFocused.current) setLocalTitle(form.title);
  }, [form?.title]);
  useEffect(() => {
    if (form && !descriptionFocused.current)
      setLocalDescription(form.description || "");
  }, [form?.description]);

  // Debounced save
  const saveTimeout = useRef<ReturnType<typeof setTimeout>>();
  const save = useCallback(
    (data: Parameters<typeof updateForm.mutate>[0]) => {
      clearTimeout(saveTimeout.current);
      saveTimeout.current = setTimeout(() => {
        updateForm.mutate(data);
      }, 500);
    },
    [updateForm],
  );

  useEffect(() => () => clearTimeout(saveTimeout.current), []);

  if (isLoading || !form) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const fields = form.fields || [];
  const selectedField = fields.find((f) => f.id === selectedFieldId);

  function updateFields(newFields: FormField[]) {
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
        <div className="flex items-center gap-3">
          <Input
            value={localTitle}
            onChange={(e) => {
              setLocalTitle(e.target.value);
              save({ id: form.id, title: e.target.value });
            }}
            onFocus={() => (titleFocused.current = true)}
            onBlur={() => (titleFocused.current = false)}
            style={{ width: `${Math.max(localTitle.length + 1, 8)}ch` }}
            className="h-8 text-sm font-medium border-none bg-transparent px-0 focus-visible:ring-0 max-w-80"
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
        </div>

        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="relative h-8 w-8"
                onClick={() => navigate(`/forms/${form.id}/responses`)}
              >
                <BarChart3 className="h-4 w-4" />
                {(form.responseCount ?? 0) > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-medium text-primary-foreground">
                    {form.responseCount}
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Responses</TooltipContent>
          </Tooltip>

          {form.status === "published" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                  <a href={`/f/${form.slug}`} target="_blank" rel="noopener">
                    <Eye className="h-4 w-4" />
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
                  <Check className="h-4 w-4" />
                ) : (
                  <Share2 className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{copied ? "Copied!" : "Share"}</TooltipContent>
          </Tooltip>

          <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
            <DialogTrigger asChild>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <Settings className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Settings</TooltipContent>
              </Tooltip>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Form Settings</DialogTitle>
              </DialogHeader>
              <FormSettingsEditor
                form={form}
                onSave={(settings) => {
                  save({ id: form.id, settings });
                  setSettingsOpen(false);
                  toast.success("Settings saved");
                }}
              />
            </DialogContent>
          </Dialog>

          <Button size="sm" className="text-xs" onClick={handleTogglePublish}>
            {form.status === "published" ? "Unpublish" : "Publish"}
          </Button>
          <AgentToggleButton />
        </div>
      </div>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Live preview */}
        <div className="flex-1 overflow-auto bg-muted/30">
          <div className="max-w-2xl mx-auto py-8 px-4">
            {/* Form header */}
            <div className="mb-6">
              <Input
                value={localTitle}
                onChange={(e) => {
                  setLocalTitle(e.target.value);
                  save({ id: form.id, title: e.target.value });
                }}
                onFocus={() => (titleFocused.current = true)}
                onBlur={() => (titleFocused.current = false)}
                className="text-2xl font-semibold border-none bg-transparent px-0 focus-visible:ring-0 h-auto"
                placeholder="Form Title"
              />
              <Textarea
                value={localDescription}
                onChange={(e) => {
                  setLocalDescription(e.target.value);
                  save({ id: form.id, description: e.target.value });
                }}
                onFocus={() => (descriptionFocused.current = true)}
                onBlur={() => (descriptionFocused.current = false)}
                className="mt-1 text-sm text-muted-foreground border-none bg-transparent px-0 focus-visible:ring-0 resize-none"
                placeholder="Add a description..."
                rows={1}
              />
            </div>

            {/* Fields */}
            <div className="space-y-3">
              {fields.map((field, idx) => (
                <div
                  key={field.id}
                  draggable
                  onDragStart={() => handleDragStart(idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDragEnd={handleDragEnd}
                  onClick={() => setSelectedFieldId(field.id)}
                  className={cn(
                    "group relative rounded-lg border p-4 transition-all cursor-pointer",
                    selectedFieldId === field.id
                      ? "border-primary ring-1 ring-primary/20 bg-card"
                      : "border-border bg-card hover:border-primary/30",
                    dragIdx === idx && "opacity-50",
                  )}
                >
                  <div className="absolute -left-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab">
                    <GripVertical className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <FieldRenderer field={field} preview disabled />
                </div>
              ))}
            </div>

            {/* Add field */}
            <div className="mt-4 flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="gap-2">
                    <Plus className="h-4 w-4" />
                    Add Field
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48">
                  {Object.entries(fieldTypeLabels).map(([type, label]) => (
                    <DropdownMenuItem
                      key={type}
                      onClick={() => addField(type as FormFieldType)}
                    >
                      {label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <Popover
                open={agentPopoverOpen}
                onOpenChange={setAgentPopoverOpen}
              >
                <PopoverTrigger asChild>
                  <Button variant="outline">Ask Agent to Help</Button>
                </PopoverTrigger>
                <PopoverContent
                  side="top"
                  align="end"
                  sideOffset={8}
                  className="w-80 p-4"
                  onOpenAutoFocus={(e) => {
                    e.preventDefault();
                    agentPromptRef.current?.focus();
                  }}
                >
                  <div className="space-y-3">
                    <div>
                      <p className="text-sm font-semibold">Ask Agent</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        What would you like help with?
                      </p>
                    </div>
                    <textarea
                      ref={agentPromptRef}
                      value={agentPrompt}
                      onChange={(e) => setAgentPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          submitAgentPrompt();
                        }
                      }}
                      placeholder="Improve this form, add missing fields, change the layout..."
                      rows={3}
                      className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-ring"
                    />
                    <p className="text-[10px] text-muted-foreground/60">
                      Enter to submit · Shift+Enter for new line
                    </p>
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        onClick={submitAgentPrompt}
                        disabled={!agentPrompt.trim()}
                        className="h-8 w-8 p-0"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>

        {/* Properties panel */}
        {selectedField && (
          <div className="w-72 border-l border-border bg-card overflow-auto shrink-0">
            <FieldPropertiesPanel
              field={selectedField}
              onChange={updateField}
              onDelete={() => deleteField(selectedField.id)}
            />
          </div>
        )}
      </div>

      {showCloudUpgrade && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <CloudUpgrade
            title="Publish Form"
            description="To publish forms publicly, connect a cloud database so submissions can be received from anywhere."
            onClose={() => setShowCloudUpgrade(false)}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form settings editor dialog
// ---------------------------------------------------------------------------

function FormSettingsEditor({
  form,
  onSave,
}: {
  form: { description?: string; settings: FormSettings; slug: string };
  onSave: (settings: FormSettings) => void;
}) {
  const [settings, setSettings] = useState<FormSettings>({ ...form.settings });

  function update(partial: Partial<FormSettings>) {
    setSettings((prev) => ({ ...prev, ...partial }));
  }

  return (
    <div className="space-y-4 py-2">
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
