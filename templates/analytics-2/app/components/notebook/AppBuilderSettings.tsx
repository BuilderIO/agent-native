import { useT } from "@agent-native/core/client/i18n";
import {
  IconGripVertical,
  IconInfoCircle,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { notebookMessages } from "@/i18n/messages/notebook";

import {
  DEFAULT_APP_STALE_HOURS,
  type AppDocument,
  type AppPatch,
} from "../../../shared/app-layout";

const messages = notebookMessages.notebook.appBuilder.settings;
const sections = [
  { label: "display", keys: ["fullWidth", "toc", "metadata"] },
  { label: "run", keys: ["scratchOnLoad", "autoRefresh", "autoRerun"] },
] as const;
type SettingsPatch = Extract<AppPatch, { type: "settings" | "tab-move" }>;

export function AppBuilderSettings({
  settings,
  tabs,
  pending,
  onChange,
  onAddTab,
  onRemoveTab,
}: {
  settings: AppDocument["settings"];
  tabs: AppDocument["tabs"];
  pending: boolean;
  onChange: (patch: SettingsPatch) => void;
  onAddTab: () => void;
  onRemoveTab: (tabId: string) => void;
}) {
  const t = useT();
  const id = useId();
  const draggedTab = useRef<string>(undefined);
  const [dropTarget, setDropTarget] = useState<string>();
  function labelFor(
    key: keyof typeof messages,
    options?: Record<string, unknown>,
  ) {
    return t(`notebook.appBuilder.settings.${key}`, {
      defaultValue: messages[key],
      ...options,
    });
  }

  function moveTab(tabId: string, toIndex: number) {
    const fromIndex = tabs.findIndex((tab) => tab.tabId === tabId);
    if (
      pending ||
      fromIndex === toIndex ||
      toIndex < 0 ||
      toIndex >= tabs.length
    )
      return;
    const previous = tabs[fromIndex < toIndex ? toIndex : toIndex - 1];
    onChange({ type: "tab-move", tabId, afterTabId: previous?.tabId ?? null });
  }

  function clearDrag() {
    draggedTab.current = undefined;
    setDropTarget(undefined);
  }

  const tabsSettings = (
    <section aria-label={labelFor("tabs")} className="grid gap-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-medium">
          {labelFor("tabs")}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={labelFor("tabsDescription")}
              >
                <IconInfoCircle size={14} aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{labelFor("tabsDescription")}</TooltipContent>
          </Tooltip>
        </h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={onAddTab}
        >
          <IconPlus size={14} aria-hidden="true" />
          {labelFor("addTab")}
        </Button>
      </div>
      {tabs.length === 1 ? (
        <div className="grid justify-items-start gap-2 rounded-md border border-dashed p-3">
          <p>{labelFor("tabsDescription")}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={onAddTab}
          >
            <IconPlus size={14} aria-hidden="true" />
            {labelFor("addTabs")}
          </Button>
        </div>
      ) : (
        <ul className="grid gap-1" aria-label={labelFor("tabs")}>
          {tabs.map(({ tabId, name, rows }, index) => {
            const count = rows.flatMap(({ columns }) =>
              columns.flatMap(({ elements }) => elements),
            ).length;
            const reorderLabel = labelFor("reorderTab", { name });
            return (
              <li
                key={tabId}
                className="nb-app-builder-settings-tab"
                data-drop-target={dropTarget === tabId || undefined}
                onDragOver={(event) => {
                  if (
                    pending ||
                    !draggedTab.current ||
                    draggedTab.current === tabId
                  )
                    return;
                  event.preventDefault();
                  setDropTarget(tabId);
                }}
                onDrop={(event) => {
                  const source = draggedTab.current;
                  if (pending || !source) return;
                  event.preventDefault();
                  clearDrag();
                  moveTab(source, index);
                }}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="cursor-grab"
                  aria-label={reorderLabel}
                  aria-keyshortcuts="ArrowUp ArrowDown"
                  aria-disabled={pending}
                  title={reorderLabel}
                  draggable={!pending}
                  onDragStart={(event) => {
                    draggedTab.current = tabId;
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("application/x-app-tab", tabId);
                  }}
                  onDragEnd={clearDrag}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowUp" && event.key !== "ArrowDown")
                      return;
                    event.preventDefault();
                    moveTab(tabId, index + (event.key === "ArrowUp" ? -1 : 1));
                  }}
                >
                  <IconGripVertical size={14} aria-hidden="true" />
                </Button>
                <span className="min-w-0 flex-1 truncate" title={name}>
                  {name}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {t("notebook.appBuilder.settings.tabElements", {
                    count,
                    defaultValue:
                      count === 1
                        ? messages.tabElements_one
                        : messages.tabElements_other,
                  })}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={labelFor("deleteNamedTab", { name })}
                  disabled={pending}
                  onClick={() => onRemoveTab(tabId)}
                >
                  <IconX size={14} aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
  const hours =
    settings.staleAfter.kind === "hours"
      ? settings.staleAfter.value
      : DEFAULT_APP_STALE_HOURS;
  const hoursLabel = t("notebook.appBuilder.settings.hours", {
    count: hours,
    defaultValue: (hours === 1
      ? messages.hours_one
      : messages.hours_other
    ).replace("{{count}}", String(hours)),
  });
  const renderSection = ({ label, keys }: (typeof sections)[number]) => (
    <fieldset key={label} className="grid gap-2">
      <legend className="mb-2 text-sm font-medium">{labelFor(label)}</legend>
      {keys.map((key) => (
        <div key={key} className="grid gap-1">
          <label className="flex items-center justify-between gap-2 text-sm">
            {labelFor(key)}
            <Switch
              checked={settings[key]}
              disabled={pending}
              onCheckedChange={(value) =>
                onChange({ type: "settings", key, value })
              }
            />
          </label>
          {key === "autoRefresh" && (
            <p className="text-xs text-muted-foreground">
              {labelFor("autoRefreshHint")}
            </p>
          )}
        </div>
      ))}
    </fieldset>
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          {labelFor("title")}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        aria-label={labelFor("title")}
        className="grid w-80 gap-4"
      >
        {renderSection(sections[0])}
        {tabsSettings}
        {renderSection(sections[1])}
        <div className="grid gap-2 text-sm" data-app-stale-after>
          <p>
            {labelFor("staleAfter")}{" "}
            <span data-app-stale-value>{hoursLabel}</span>
          </p>
          <form
            className="mt-2 flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const input = event.currentTarget.elements.namedItem("hours");
              if (!(input instanceof HTMLInputElement) || !input.validity.valid)
                return;
              onChange({
                type: "settings",
                key: "staleAfter",
                value: { kind: "hours", value: input.valueAsNumber },
              });
            }}
          >
            <div>
              <label htmlFor={id}>{labelFor("staleHours")}</label>
              <Input
                key={hours}
                id={id}
                name="hours"
                type="number"
                defaultValue={hours}
                required
                min={1}
                max={8760}
              />
            </div>
            <Button type="submit" size="sm" disabled={pending}>
              {labelFor("save")}
            </Button>
          </form>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={
              pending || settings.staleAfter.kind === "workspace-default"
            }
            onClick={() =>
              onChange({
                type: "settings",
                key: "staleAfter",
                value: { kind: "workspace-default" },
              })
            }
          >
            {labelFor("workspaceDefault")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
