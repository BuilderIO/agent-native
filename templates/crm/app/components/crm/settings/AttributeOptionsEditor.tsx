import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconArchive,
  IconArrowBackUp,
  IconChevronDown,
  IconChevronUp,
  IconGripVertical,
  IconPlus,
} from "@tabler/icons-react";
import { useState, type ReactNode } from "react";
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import type {
  CrmAttributeDefinition,
  CrmAttributeOption,
} from "../../../../shared/crm-contract";
import {
  attributeTypeCapabilities,
  moveItem,
  reorderedOptionIds,
} from "./settings-admin";

/** Option colors offered by the picker, with the swatch each one renders as. */
const OPTION_COLORS: Array<{ value: string; swatch: string }> = [
  { value: "gray", swatch: "bg-muted-foreground/50" },
  { value: "blue", swatch: "bg-sky-500" },
  { value: "green", swatch: "bg-emerald-500" },
  { value: "amber", swatch: "bg-amber-500" },
  { value: "red", swatch: "bg-rose-500" },
  { value: "purple", swatch: "bg-violet-500" },
];

const NO_COLOR = "__none__";

interface ManageOptionInput {
  attributeId: string;
  operation: "add" | "update" | "archive" | "reorder";
  optionId?: string;
  value?: string;
  title?: string;
  color?: string | null;
  targetDays?: number | null;
  celebrate?: boolean;
  archived?: boolean;
  optionIds?: string[];
}

type OptionUpdateInput = Omit<
  ManageOptionInput,
  "attributeId" | "operation" | "optionId"
>;

export function AttributeOptionsEditor({
  attribute,
  patchAttribute,
  trigger,
}: {
  attribute: CrmAttributeDefinition;
  patchAttribute: (
    attributeId: string,
    patch: Partial<CrmAttributeDefinition>,
  ) => () => void;
  trigger: ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [newValue, setNewValue] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const manage = useActionMutation<
    { options?: CrmAttributeOption[] },
    ManageOptionInput
  >("manage-crm-attribute-option" as never);
  const showStageFields = attributeTypeCapabilities(
    attribute.attributeType,
  ).showsStageFields;
  const options = attribute.options ?? [];

  /**
   * Every option write goes through here so the optimistic options and the
   * rollback stay in one place: a half-applied reorder is worse than no
   * optimism at all.
   */
  async function apply(input: ManageOptionInput, next: CrmAttributeOption[]) {
    const rollback = patchAttribute(attribute.id, { options: next });
    try {
      const result = await manage.mutateAsync(input);
      if (result?.options) {
        patchAttribute(attribute.id, { options: result.options });
      }
    } catch (error) {
      rollback();
      toast.error(
        error instanceof Error ? error.message : t("fields.optionFailed"),
      );
    }
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= options.length || from === to) return;
    const next = moveItem(options, from, to).map((option, position) => ({
      ...option,
      position,
    }));
    void apply(
      {
        attributeId: attribute.id,
        operation: "reorder",
        optionIds: reorderedOptionIds(options, from, to),
      },
      next,
    );
  }

  function patchOption(
    optionId: string,
    patch: Partial<CrmAttributeOption>,
    input: OptionUpdateInput,
  ) {
    void apply(
      {
        attributeId: attribute.id,
        operation: "update",
        optionId,
        ...input,
      },
      options.map((option) =>
        option.id === optionId ? { ...option, ...patch } : option,
      ),
    );
  }

  async function addOption() {
    const value = newValue.trim();
    if (!value) return;
    setNewValue("");
    await apply(
      { attributeId: attribute.id, operation: "add", value, title: value },
      [
        ...options,
        {
          id: `pending-${value}`,
          value,
          title: value,
          position: options.length,
          archived: false,
        },
      ],
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {t("fields.optionsTitle", { name: attribute.label })}
          </DialogTitle>
          <DialogDescription>
            {showStageFields
              ? t("fields.optionsStageDescription")
              : t("fields.optionsDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          {options.map((option, index) => (
            <div
              key={option.id}
              draggable
              onDragStart={() => setDragIndex(index)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (dragIndex !== null) move(dragIndex, index);
                setDragIndex(null);
              }}
              onDragEnd={() => setDragIndex(null)}
              className={`flex flex-wrap items-center gap-2 rounded-md border border-border/70 bg-card px-2 py-2 ${
                option.archived ? "opacity-60" : ""
              }`}
            >
              <IconGripVertical
                aria-hidden="true"
                className="size-4 shrink-0 cursor-grab text-muted-foreground"
              />
              <div className="flex shrink-0 flex-col">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-5"
                  aria-label={t("fields.moveOptionUp", { name: option.title })}
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                >
                  <IconChevronUp className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-5"
                  aria-label={t("fields.moveOptionDown", {
                    name: option.title,
                  })}
                  disabled={index === options.length - 1}
                  onClick={() => move(index, index + 1)}
                >
                  <IconChevronDown className="size-3.5" />
                </Button>
              </div>
              <Input
                className="min-w-32 flex-1"
                defaultValue={option.title}
                maxLength={200}
                aria-label={t("fields.optionTitleAria", {
                  value: option.value,
                })}
                onBlur={(event) => {
                  const title = event.target.value.trim();
                  if (!title || title === option.title) return;
                  patchOption(option.id, { title }, { title });
                }}
              />
              <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {option.value}
              </code>
              <Select
                value={option.color ?? NO_COLOR}
                onValueChange={(color) =>
                  patchOption(
                    option.id,
                    { color: color === NO_COLOR ? undefined : color },
                    { color: color === NO_COLOR ? null : color },
                  )
                }
              >
                <SelectTrigger
                  className="w-32"
                  aria-label={t("fields.optionColorAria", {
                    name: option.title,
                  })}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_COLOR}>
                    {t("fields.colorNone")}
                  </SelectItem>
                  {OPTION_COLORS.map((color) => (
                    <SelectItem key={color.value} value={color.value}>
                      <span className="flex items-center gap-2">
                        <span
                          className={`size-2.5 rounded-full ${color.swatch}`}
                        />
                        {color.value}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {showStageFields ? (
                <>
                  <Input
                    className="w-24"
                    type="number"
                    min={0}
                    defaultValue={option.targetDays ?? ""}
                    aria-label={t("fields.targetDaysAria", {
                      name: option.title,
                    })}
                    placeholder={t("fields.targetDays")}
                    onBlur={(event) => {
                      const raw = event.target.value.trim();
                      const targetDays = raw ? Number(raw) : null;
                      if (targetDays === (option.targetDays ?? null)) return;
                      patchOption(option.id, { targetDays }, { targetDays });
                    }}
                  />
                  <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <Switch
                      checked={option.celebrate ?? false}
                      aria-label={t("fields.celebrateAria", {
                        name: option.title,
                      })}
                      onCheckedChange={(celebrate) =>
                        patchOption(option.id, { celebrate }, { celebrate })
                      }
                    />
                    {t("fields.celebrate")}
                  </label>
                </>
              ) : null}
              {option.archived ? (
                <Badge variant="outline" className="font-normal">
                  {t("fields.archived")}
                </Badge>
              ) : null}
              {option.archived ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("fields.restoreOptionAria", {
                    name: option.title,
                  })}
                  onClick={() =>
                    patchOption(
                      option.id,
                      { archived: false },
                      { archived: false },
                    )
                  }
                >
                  <IconArrowBackUp className="size-4" />
                </Button>
              ) : (
                <ArchiveOptionButton
                  option={option}
                  onArchive={() =>
                    void apply(
                      {
                        attributeId: attribute.id,
                        operation: "archive",
                        optionId: option.id,
                        archived: true,
                      },
                      options.map((current) =>
                        current.id === option.id
                          ? { ...current, archived: true }
                          : current,
                      ),
                    )
                  }
                />
              )}
            </div>
          ))}
          {options.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
              {t("fields.optionsEmpty")}
            </p>
          ) : null}
        </div>

        <div className="grid gap-2 border-t border-border/70 pt-4">
          <Label htmlFor="new-option-value">{t("fields.addOption")}</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="new-option-value"
              className="flex-1"
              value={newValue}
              maxLength={200}
              placeholder={t("fields.optionValuePlaceholder")}
              onChange={(event) => setNewValue(event.target.value)}
            />
            <Button
              className="gap-1.5"
              disabled={!newValue.trim()}
              onClick={() => void addOption()}
            >
              <IconPlus className="size-4" /> {t("fields.addOption")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("fields.optionValueImmutable")}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ArchiveOptionButton({
  option,
  onArchive,
}: {
  option: CrmAttributeOption;
  onArchive: () => void;
}) {
  const t = useT();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("fields.archiveOptionAria", { name: option.title })}
        >
          <IconArchive className="size-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("fields.archiveOptionTitle", { name: option.title })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("fields.archiveOptionDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("fields.cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={onArchive}>
            {t("fields.archive")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
