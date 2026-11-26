import { Button } from "@agent-native/toolkit/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import { Input } from "@agent-native/toolkit/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@agent-native/toolkit/ui/popover";
import { cn } from "@agent-native/toolkit/utils";
import {
  IconChevronDown,
  IconDots,
  IconDeviceFloppy,
} from "@tabler/icons-react";
import { useEffect, useId, useRef, useState } from "react";

import { useFilterText, type FilterText } from "./text.js";

export interface FilterSavedView {
  id: string;
  name: string;
  shared: boolean;
  mine: boolean;
  author?: string;
}

export interface FilterViewsControlProps {
  views: readonly FilterSavedView[];
  activeViewId: string | null;
  defaultLabel: string;
  dirty: boolean;
  suggestedName: string;
  canSaveForEveryone?: boolean;
  onSelect: (viewId: string | null) => void;
  onSave: (view: { name: string; shared: boolean }) => void;
  onUpdate: (viewId: string) => void;
  onShare: (viewId: string) => void;
  onRename: (viewId: string, name: string) => void;
  onDelete: (viewId: string) => void;
  className?: string;
}

type ViewTask =
  | { kind: "save"; shared: boolean }
  | { kind: "rename"; view: FilterSavedView }
  | { kind: "delete"; view: FilterSavedView };

export function filterViewNameError(
  name: string,
  views: readonly FilterSavedView[],
  exceptId?: string,
): "required" | "taken" | null {
  if (name.trim() === "") return "required";
  const taken = views.some(
    (view) => view.id !== exceptId && sameViewName(view.name, name),
  );
  return taken ? "taken" : null;
}

function sameViewName(a: string, b: string) {
  const left = a.trim().normalize("NFC");
  const right = b.trim().normalize("NFC");
  return (
    left.toLowerCase() === right.toLowerCase() ||
    left.toUpperCase() === right.toUpperCase()
  );
}

function ViewNameForm({
  initialName,
  views,
  exceptId,
  text,
  onSubmit,
  onCancel,
}: {
  initialName: string;
  views: readonly FilterSavedView[];
  exceptId?: string | undefined;
  text: FilterText;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(initialName);
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const error = filterViewNameError(name, views, exceptId);
  const message =
    error === "taken"
      ? text.t("agentChat.filters.views.nameTaken", { name: name.trim() })
      : error === "required"
        ? text.t("agentChat.filters.views.nameRequired")
        : null;
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (error === null) onSubmit(name.trim());
      }}
    >
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {text.t("agentChat.filters.views.name")}
      </label>
      <Input
        id={id}
        ref={inputRef}
        value={name}
        aria-invalid={touched && error !== null}
        aria-describedby={message ? `${id}-error` : undefined}
        onChange={(event) => {
          setName(event.target.value);
          setTouched(true);
        }}
        className="h-8"
      />
      {touched && message ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {message}
        </p>
      ) : null}
      <div className="flex justify-end gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {text.t("agentChat.filters.views.cancel")}
        </Button>
        <Button type="submit" size="sm" disabled={touched && error !== null}>
          {text.t("agentChat.filters.views.save")}
        </Button>
      </div>
    </form>
  );
}

export function FilterViewsControl({
  views,
  activeViewId,
  defaultLabel,
  dirty,
  suggestedName,
  canSaveForEveryone = true,
  onSelect,
  onSave,
  onUpdate,
  onShare,
  onRename,
  onDelete,
  className,
}: FilterViewsControlProps) {
  const text = useFilterText();
  const [task, setTask] = useState<ViewTask | null>(null);
  const active = views.find((view) => view.id === activeViewId) ?? null;
  const activeLabel = active?.name ?? defaultLabel;
  const mine = views.filter((view) => view.mine);
  const team = views.filter((view) => !view.mine);
  const close = () => setTask(null);
  const keepFocus = (event: Event) => {
    event.preventDefault();
  };

  return (
    <Popover
      open={task !== null}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <PopoverAnchor asChild>
        <div
          className={cn(
            "flex min-w-0 max-w-full items-center gap-1",
            className,
          )}
        >
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                title={activeLabel}
                className="h-8 min-w-0 max-w-[16rem] gap-1 px-2 font-medium"
              >
                <span className="truncate">{activeLabel}</span>
                <IconChevronDown className="size-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              collisionPadding={8}
              className="max-w-[min(20rem,calc(100vw-1rem))]"
            >
              <DropdownMenuRadioGroup
                value={activeViewId ?? ""}
                onValueChange={(value) => onSelect(value === "" ? null : value)}
              >
                <DropdownMenuRadioItem value="">
                  <span className="truncate">{defaultLabel}</span>
                </DropdownMenuRadioItem>
                {mine.length > 0 ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs text-muted-foreground">
                      {text.t("agentChat.filters.views.yours")}
                    </DropdownMenuLabel>
                    {mine.map((view) => (
                      <DropdownMenuRadioItem key={view.id} value={view.id}>
                        <span className="min-w-0 truncate" title={view.name}>
                          {view.name}
                        </span>
                      </DropdownMenuRadioItem>
                    ))}
                  </>
                ) : null}
                {team.length > 0 ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs text-muted-foreground">
                      {text.t("agentChat.filters.views.team")}
                    </DropdownMenuLabel>
                    {team.map((view) => (
                      <DropdownMenuRadioItem key={view.id} value={view.id}>
                        <span className="min-w-0 truncate" title={view.name}>
                          {view.name}
                        </span>
                        {view.author ? (
                          <span className="ms-auto shrink-0 ps-2 text-xs text-muted-foreground">
                            {text.t("agentChat.filters.views.byAuthor", {
                              name: view.author,
                            })}
                          </span>
                        ) : null}
                      </DropdownMenuRadioItem>
                    ))}
                  </>
                ) : null}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {active && !active.mine && active.author ? (
            <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
              {text.t("agentChat.filters.views.byAuthor", {
                name: active.author,
              })}
            </span>
          ) : null}
          {dirty ? (
            <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {text.t("agentChat.filters.views.notSaved")}
            </span>
          ) : null}
          {dirty ? (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 gap-1"
                >
                  <IconDeviceFloppy />
                  {text.t("agentChat.filters.views.save")}
                  <IconChevronDown className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                collisionPadding={8}
                onCloseAutoFocus={(event) => {
                  if (task) keepFocus(event);
                }}
              >
                {active?.mine ? (
                  <DropdownMenuItem onSelect={() => onUpdate(active.id)}>
                    <span className="min-w-0 truncate">
                      {text.t("agentChat.filters.views.updateNamed", {
                        name: active.name,
                      })}
                    </span>
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  onSelect={() => setTask({ kind: "save", shared: false })}
                >
                  <div className="flex flex-col">
                    <span>{text.t("agentChat.filters.views.saveForMe")}</span>
                    <span className="text-xs text-muted-foreground">
                      {text.t("agentChat.filters.views.onlyYou")}
                    </span>
                  </div>
                </DropdownMenuItem>
                {canSaveForEveryone ? (
                  <DropdownMenuItem
                    onSelect={() => setTask({ kind: "save", shared: true })}
                  >
                    <div className="flex flex-col">
                      <span>
                        {text.t("agentChat.filters.views.saveForEveryone")}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {text.t("agentChat.filters.views.everyoneSees")}
                      </span>
                    </div>
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {active?.mine ? (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={text.t("agentChat.filters.views.menu", {
                    name: active.name,
                  })}
                  className="shrink-0"
                >
                  <IconDots />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                collisionPadding={8}
                onCloseAutoFocus={(event) => {
                  if (task) keepFocus(event);
                }}
              >
                <DropdownMenuItem
                  disabled={!dirty}
                  onSelect={() => onUpdate(active.id)}
                >
                  {text.t("agentChat.filters.views.update")}
                </DropdownMenuItem>
                {!active.shared && canSaveForEveryone ? (
                  <DropdownMenuItem onSelect={() => onShare(active.id)}>
                    {text.t("agentChat.filters.views.shareWithEveryone")}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  onSelect={() => setTask({ kind: "rename", view: active })}
                >
                  {text.t("agentChat.filters.views.rename")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setTask({ kind: "delete", view: active })}
                  className="text-destructive focus:text-destructive"
                >
                  {text.t("agentChat.filters.views.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="end"
        collisionPadding={8}
        className="w-[min(18rem,calc(100vw-1rem))] p-3"
      >
        {task?.kind === "delete" ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              {text.t("agentChat.filters.views.deleteConfirm", {
                name: task.view.name,
              })}
            </p>
            <div className="flex justify-end gap-1">
              <Button type="button" variant="ghost" size="sm" onClick={close}>
                {text.t("agentChat.filters.views.cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => {
                  onDelete(task.view.id);
                  close();
                }}
              >
                {text.t("agentChat.filters.views.delete")}
              </Button>
            </div>
          </div>
        ) : task ? (
          <ViewNameForm
            key={task.kind === "rename" ? task.view.id : `save-${task.shared}`}
            initialName={
              task.kind === "rename" ? task.view.name : suggestedName
            }
            views={views}
            exceptId={task.kind === "rename" ? task.view.id : undefined}
            text={text}
            onCancel={close}
            onSubmit={(name) => {
              if (task.kind === "rename") onRename(task.view.id, name);
              else onSave({ name, shared: task.shared });
              close();
            }}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
