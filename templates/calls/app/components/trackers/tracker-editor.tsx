import { useEffect, useMemo, useState } from "react";
import { useActionMutation } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";
import { IconTarget, IconBrain, IconX, IconCheck } from "@tabler/icons-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type TrackerKind = "keyword" | "smart";

const COLOR_PALETTE = [
  "#111111",
  "#2b2b2b",
  "#4a4a4a",
  "#6b6b6b",
  "#8e8e8e",
  "#bfbfbf",
];

export interface TrackerEditorValue {
  id?: string;
  name: string;
  description: string;
  kind: TrackerKind;
  keywords: string[];
  classifierPrompt: string;
  color: string;
  enabled: boolean;
}

const EMPTY: TrackerEditorValue = {
  name: "",
  description: "",
  kind: "keyword",
  keywords: [],
  classifierPrompt: "",
  color: COLOR_PALETTE[0],
  enabled: true,
};

interface TrackerEditorProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  initial?: Partial<TrackerEditorValue>;
  workspaceId?: string;
  trackerId?: string;
  onSaved?: () => void;
  onCancel?: () => void;
}

export function TrackerEditor({
  open: openProp,
  onOpenChange,
  initial,
  workspaceId,
  trackerId,
  onSaved,
  onCancel,
}: TrackerEditorProps) {
  const open = openProp ?? true;
  const handleOpenChange =
    onOpenChange ??
    ((next: boolean) => {
      if (!next) onCancel?.();
    });
  void trackerId;
  void onSaved;
  const qc = useQueryClient();
  const [value, setValue] = useState<TrackerEditorValue>({
    ...EMPTY,
    ...initial,
  });
  const [keywordDraft, setKeywordDraft] = useState("");
  const isEdit = !!initial?.id;

  useEffect(() => {
    if (open) {
      setValue({ ...EMPTY, ...initial });
      setKeywordDraft("");
    }
  }, [open, initial]);

  const createTracker = useActionMutation<
    any,
    {
      name: string;
      description?: string;
      kind: TrackerKind;
      keywords?: string[];
      classifierPrompt?: string;
      color?: string;
      enabled?: boolean;
      workspaceId?: string;
    }
  >("create-tracker");

  const updateTracker = useActionMutation<
    any,
    {
      id: string;
      name?: string;
      description?: string;
      kind?: TrackerKind;
      keywords?: string[];
      classifierPrompt?: string;
      color?: string;
      enabled?: boolean;
    }
  >("update-tracker");

  const pending = createTracker.isPending || updateTracker.isPending;

  function addKeyword(raw: string) {
    const parts = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    setValue((v) => ({
      ...v,
      keywords: Array.from(new Set([...v.keywords, ...parts])),
    }));
    setKeywordDraft("");
  }

  function removeKeyword(k: string) {
    setValue((v) => ({ ...v, keywords: v.keywords.filter((x) => x !== k) }));
  }

  const valid = useMemo(() => {
    if (!value.name.trim()) return false;
    if (value.kind === "keyword" && value.keywords.length === 0) return false;
    if (value.kind === "smart" && !value.classifierPrompt.trim()) return false;
    return true;
  }, [value]);

  async function handleSave() {
    if (!valid) return;
    try {
      if (isEdit && initial?.id) {
        await updateTracker.mutateAsync({
          id: initial.id,
          name: value.name.trim(),
          description: value.description.trim(),
          kind: value.kind,
          keywords: value.keywords,
          classifierPrompt: value.classifierPrompt.trim(),
          color: value.color,
          enabled: value.enabled,
        });
        toast.success("Tracker updated");
      } else {
        await createTracker.mutateAsync({
          name: value.name.trim(),
          description: value.description.trim(),
          kind: value.kind,
          keywords: value.keywords,
          classifierPrompt: value.classifierPrompt.trim(),
          color: value.color,
          enabled: value.enabled,
          workspaceId,
        });
        toast.success("Tracker created");
      }
      qc.invalidateQueries({ queryKey: ["action", "list-trackers"] });
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit tracker" : "New tracker"}</DialogTitle>
          <DialogDescription>
            Trackers flag moments in your calls — by keyword match or by a smart
            classifier.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tracker-name">Name</Label>
            <Input
              id="tracker-name"
              value={value.name}
              onChange={(e) =>
                setValue((v) => ({ ...v, name: e.target.value }))
              }
              placeholder="e.g. Pricing objections"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tracker-desc">Description</Label>
            <Input
              id="tracker-desc"
              value={value.description}
              onChange={(e) =>
                setValue((v) => ({ ...v, description: e.target.value }))
              }
              placeholder="Optional — what does this tracker measure?"
            />
          </div>

          <div className="space-y-2">
            <Label>Detection type</Label>
            <RadioGroup
              value={value.kind}
              onValueChange={(v) =>
                setValue((s) => ({ ...s, kind: v as TrackerKind }))
              }
              className="grid grid-cols-2 gap-2"
            >
              <KindOption
                value="keyword"
                current={value.kind}
                icon={<IconTarget className="h-4 w-4" />}
                title="Keyword"
                description="Match exact words or phrases"
              />
              <KindOption
                value="smart"
                current={value.kind}
                icon={<IconBrain className="h-4 w-4" />}
                title="Smart"
                description="Classify semantically"
              />
            </RadioGroup>
          </div>

          {value.kind === "keyword" ? (
            <div className="space-y-1.5">
              <Label htmlFor="tracker-keywords">Keywords</Label>
              <div className="flex flex-wrap gap-1.5 rounded-md border border-input bg-background p-1.5 min-h-[2.5rem]">
                {value.keywords.map((k) => (
                  <span
                    key={k}
                    className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-muted text-xs"
                  >
                    {k}
                    <button
                      type="button"
                      onClick={() => removeKeyword(k)}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={`Remove ${k}`}
                    >
                      <IconX className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <input
                  id="tracker-keywords"
                  value={keywordDraft}
                  onChange={(e) => setKeywordDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      addKeyword(keywordDraft);
                    } else if (
                      e.key === "Backspace" &&
                      !keywordDraft &&
                      value.keywords.length
                    ) {
                      removeKeyword(value.keywords[value.keywords.length - 1]);
                    }
                  }}
                  onBlur={() => keywordDraft && addKeyword(keywordDraft)}
                  onPaste={(e) => {
                    const text = e.clipboardData.getData("text");
                    if (text.includes(",") || text.includes("\n")) {
                      e.preventDefault();
                      addKeyword(text.replace(/\n/g, ","));
                    }
                  }}
                  placeholder={
                    value.keywords.length
                      ? "Add another…"
                      : "Type and press Enter (comma-separated OK)"
                  }
                  className="flex-1 min-w-[8rem] bg-transparent text-sm outline-none px-1"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Case-insensitive. Separate multiple with commas.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="tracker-prompt">Classifier prompt</Label>
              <Textarea
                id="tracker-prompt"
                value={value.classifierPrompt}
                onChange={(e) =>
                  setValue((v) => ({ ...v, classifierPrompt: e.target.value }))
                }
                placeholder="Mark any segment where the prospect raises a concern or objection about pricing."
                rows={4}
              />
              <p className="text-[11px] text-muted-foreground">
                Written like an instruction. The classifier runs on each
                transcript segment.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label>Color</Label>
            <div className="flex items-center gap-2">
              {COLOR_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setValue((v) => ({ ...v, color: c }))}
                  className={cn(
                    "h-7 w-7 rounded-full border",
                    value.color === c
                      ? "border-foreground ring-2 ring-foreground/20"
                      : "border-border",
                  )}
                  style={{ background: c }}
                  aria-label={`Color ${c}`}
                >
                  {value.color === c && (
                    <IconCheck className="h-3.5 w-3.5 text-background mx-auto" />
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <div className="text-sm font-medium">Enabled</div>
              <div className="text-xs text-muted-foreground">
                Disabled trackers won't run on new calls.
              </div>
            </div>
            <Switch
              checked={value.enabled}
              onCheckedChange={(v) => setValue((s) => ({ ...s, enabled: !!v }))}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={!valid || pending}
          >
            {pending ? "Saving…" : isEdit ? "Save changes" : "Create tracker"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KindOption({
  value,
  current,
  icon,
  title,
  description,
}: {
  value: TrackerKind;
  current: TrackerKind;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  const active = current === value;
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2 rounded-md border p-3 text-left",
        active
          ? "border-foreground bg-accent/40"
          : "border-border hover:bg-accent/40",
      )}
    >
      <RadioGroupItem value={value} id={`kind-${value}`} className="mt-0.5" />
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          {icon}
          {title}
        </div>
        <div className="text-[11px] text-muted-foreground">{description}</div>
      </div>
    </label>
  );
}
