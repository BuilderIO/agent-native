import { trackEvent } from "@agent-native/core/client/analytics";
import { useT } from "@agent-native/core/client/i18n";
import { IconCheck, IconChevronDown, IconTemplate } from "@tabler/icons-react";

import { TemplatePreview } from "@/components/templates/TemplatePreview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface PromptTemplateOption {
  id: string;
  title: string;
  description?: string | null;
  category?: string;
  width?: number | null;
  height?: number | null;
  previewHtml?: string | null;
  isBuiltIn: boolean;
}

export function TemplatePickerControl({
  open,
  onOpenChange,
  options,
  loading,
  selectedId,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: PromptTemplateOption[];
  loading: boolean;
  selectedId: string | null;
  onChange: (id: string | null) => void;
}) {
  const t = useT();
  const selected = options.find((option) => option.id === selectedId) ?? null;
  const userTemplates = options.filter((option) => !option.isBuiltIn);
  const builtInTemplates = options.filter((option) => option.isBuiltIn);

  const choose = (id: string | null) => {
    const selectedTemplate = id
      ? options.find((option) => option.id === id)
      : null;
    trackEvent("design_template_selected", {
      app_name: "design",
      template_name: "design",
      template_source:
        id === null
          ? "blank"
          : selectedTemplate?.isBuiltIn
            ? "built_in"
            : "user",
    });
    onChange(id);
    onOpenChange(false);
  };

  const item = (template: PromptTemplateOption) => (
    <CommandItem
      key={template.id}
      value={`${template.title} ${template.description ?? ""} ${template.category ?? ""}`}
      onSelect={() => choose(template.id)}
      data-template-option={template.id}
      className="min-h-12 gap-3 px-3 py-2"
    >
      <TemplatePreview
        html={template.previewHtml}
        title={template.title}
        width={template.width}
        height={template.height}
        className="h-8 w-12 shrink-0 rounded-md border bg-muted/40"
      />
      <span className="min-w-0 flex-1 truncate">{template.title}</span>
      {template.isBuiltIn ? (
        <Badge
          variant="secondary"
          className="h-5 shrink-0 px-1.5 text-[10px] font-medium"
        >
          {t("promptDialog.builtIn")}
        </Badge>
      ) : null}
      {selectedId === template.id ? (
        <IconCheck className="size-4 shrink-0" />
      ) : null}
    </CommandItem>
  );

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 w-full min-w-0 justify-start gap-2 px-2.5 text-xs"
          aria-label={t("promptDialog.chooseTemplate")}
          disabled={loading}
          data-template-picker-trigger
        >
          {selected ? (
            <TemplatePreview
              html={selected.previewHtml}
              title={selected.title}
              width={selected.width}
              height={selected.height}
              className="h-4 w-7 shrink-0 rounded-[3px] border bg-muted/40"
            />
          ) : (
            <IconTemplate className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span
            className={cn(
              "min-w-0 truncate",
              selected ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {t("promptDialog.template")} ·{" "}
            {selected ? selected.title : t("promptDialog.blank")}
          </span>
          {selected?.isBuiltIn ? (
            <Badge
              variant="secondary"
              className="h-5 shrink-0 px-1.5 text-[10px] font-medium"
            >
              {t("promptDialog.builtIn")}
            </Badge>
          ) : null}
          <IconChevronDown className="ms-auto size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        data-agent-native-template-popover
        className="w-[min(360px,calc(100vw-32px))] p-0"
      >
        <Command>
          <CommandInput placeholder={t("promptDialog.searchTemplates")} />
          <CommandList className="max-h-[min(420px,60vh)]">
            <CommandEmpty>{t("promptDialog.noTemplatesFound")}</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value={t("promptDialog.blank")}
                onSelect={() => choose(null)}
                data-template-option="blank"
                className="min-h-12 gap-3 px-3 py-2"
              >
                <span className="flex h-8 w-12 shrink-0 items-center justify-center rounded-md border bg-muted/40 text-muted-foreground">
                  <IconTemplate className="size-4" />
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {t("promptDialog.blank")}
                </span>
                {!selectedId ? <IconCheck className="size-4 shrink-0" /> : null}
              </CommandItem>
            </CommandGroup>
            {userTemplates.length > 0 ? (
              <CommandGroup heading={t("promptDialog.yourTemplates")}>
                {userTemplates.map(item)}
              </CommandGroup>
            ) : null}
            {builtInTemplates.length > 0 ? (
              <CommandGroup heading={t("promptDialog.builtInTemplates")}>
                {builtInTemplates.map(item)}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
