import { IconCheck, IconListSearch, IconX } from "@tabler/icons-react";
import {
  useContext,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";

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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  activeOptions,
  optionValue,
  withFieldsToKeep,
  type ApiRequestArgs,
  type ApiRequestShape,
} from "@/lib/workflow-editor/api-request";
import {
  addPaths,
  checkFieldsToKeep,
  chipsOf,
  removePathAt,
  splitPaths,
  togglePath,
  type KeepCheck,
} from "@/lib/workflow-editor/fields-to-keep";

import {
  ApiResponseContext,
  pickerStateOf,
  type PickerReason,
} from "../../../workflow/api-response-picker";
import { useWorkflowCanvasStrings } from "../../strings";
import { useQuietMarks } from "../issue-marks";

interface FieldsToKeepProps {
  shape: ApiRequestShape;
  args: ApiRequestArgs;
  onArgs: (args: ApiRequestArgs) => void;
}

/** Why the picker is off, in the words the tooltip on it uses. */
function useReasonText(): (reason: PickerReason) => string {
  const s = useWorkflowCanvasStrings().inspector.apiRequest;
  return (reason) => {
    switch (reason) {
      case "needs_test":
        return s.pickNeedsTest;
      case "running":
        return s.pickRunning;
      case "failed":
        return s.pickFailed;
      case "no_fields":
        return s.pickNoFields;
    }
  };
}

/**
 * The fields of the last test's answer, to pick from. Picking toggles the same
 * chips that typing makes. A cut answer is listed as far as it goes, and says so.
 */
function ResponsePicker({
  shape,
  args,
  chips,
  onChips,
}: FieldsToKeepProps & {
  chips: readonly string[];
  onChips: (chips: string[]) => void;
}) {
  const strings = useWorkflowCanvasStrings();
  const s = strings.inspector.apiRequest;
  const reasonText = useReasonText();
  const response = useContext(ApiResponseContext);
  const [open, setOpen] = useState(false);
  const state = pickerStateOf(response, {
    includeStatus: activeOptions(shape, args).includes("includeStatus"),
  });

  const trigger = (
    <Button
      type="button"
      variant="outline"
      size="xs"
      className="self-start"
      disabled={state.kind === "disabled"}
    >
      <IconListSearch />
      {s.pickFromResponse}
    </Button>
  );
  if (state.kind === "disabled") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {/* A disabled button takes no hover, so the span carries the tooltip. */}
          <span tabIndex={0} className="self-start rounded-md">
            {trigger}
          </span>
        </TooltipTrigger>
        <TooltipContent>{reasonText(state.reason)}</TooltipContent>
      </Tooltip>
    );
  }
  const held = new Set(chips.map((chip) => chip.trim()));
  const notes = [
    ...(state.cut ? [s.pickCutNote] : []),
    ...(state.capped ? [s.pickCapped(state.paths.length)] : []),
    ...(chips.length > 0 ? [s.pickKeptNote] : []),
  ];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder={s.pickSearch} />
          <CommandList className="max-h-64">
            <CommandEmpty>{strings.inspector.noPaths}</CommandEmpty>
            <CommandGroup>
              {state.paths.map((path) => (
                <CommandItem
                  key={path}
                  value={path}
                  onSelect={() => onChips(togglePath(chips, path))}
                >
                  <IconCheck
                    aria-hidden
                    className={cn(
                      "size-4 shrink-0",
                      held.has(path) ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate font-mono text-xs">{path}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {notes.length > 0 ? (
            <div className="flex flex-col gap-1 border-t border-border px-3 py-2 text-xs text-muted-foreground">
              {notes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Fields to keep: one chip for each path, added by typing and pressing Enter or
 * comma, or by pasting a list, and removed with its x or with Backspace in the
 * empty box. A path the server would refuse stays a chip, marked and explained,
 * and is saved as typed, so nothing is dropped without a trace.
 */
export function FieldsToKeepBody({ shape, args, onArgs }: FieldsToKeepProps) {
  const s = useWorkflowCanvasStrings().inspector.apiRequest;
  const quiet = useQuietMarks();
  const saved = optionValue(shape, args, "fieldsToKeep");
  const chips = chipsOf(saved) ?? [];
  const [draft, setDraft] = useState("");
  const check: KeepCheck =
    saved === undefined ? { paths: [] } : checkFieldsToKeep(saved);
  const flagged = new Map(
    check.paths.map((problem) => [problem.index, problem]),
  );

  const setChips = (next: string[]) =>
    onArgs(withFieldsToKeep(shape, args, next));
  const add = (typed: readonly string[]) => {
    if (typed.length > 0) setChips(addPaths(chips, typed));
  };

  const onChange = (text: string) => {
    // A comma ends a path, so what comes before the last one is added and the rest is still being typed.
    const parts = text.split(/[,\n\r]/);
    if (parts.length === 1) {
      setDraft(text);
      return;
    }
    const [rest = ""] = parts.slice(-1);
    add(splitPaths(parts.slice(0, -1).join(",")));
    setDraft(rest);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      add(splitPaths(draft));
      setDraft("");
    } else if (event.key === "Backspace" && draft === "" && chips.length > 0) {
      event.preventDefault();
      setChips(removePathAt(chips, chips.length - 1));
    }
  };
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData("text");
    if (!/[,\n\r]/.test(pasted)) return;
    event.preventDefault();
    add(splitPaths(`${draft}${pasted}`));
    setDraft("");
  };

  const listProblem =
    !quiet && check.list !== undefined
      ? s.problem.sentence({
          field: "fieldsToKeep",
          code: "invalid_fields_to_keep",
          reason: check.list,
        })
      : undefined;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring">
        {chips.map((path, index) => {
          const bad = !quiet && flagged.has(index);
          return (
            <span
              key={`${index}:${path}`}
              className={cn(
                "inline-flex max-w-full items-center gap-1 rounded-md px-2 py-0.5 font-mono text-xs",
                bad
                  ? "bg-destructive/10 text-destructive"
                  : "bg-muted text-foreground",
              )}
            >
              <span className="truncate">{path}</span>
              <button
                type="button"
                aria-label={s.removeField(path)}
                title={s.removeField(path)}
                className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setChips(removePathAt(chips, index))}
              >
                <IconX className="size-3" aria-hidden />
              </button>
            </span>
          );
        })}
        <input
          value={draft}
          aria-label={s.fieldsInputLabel}
          placeholder={chips.length === 0 ? s.fieldsPlaceholder : undefined}
          className="min-w-32 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => {
            add(splitPaths(draft));
            setDraft("");
          }}
        />
      </div>
      {listProblem ? (
        <p role="alert" className="text-xs text-destructive">
          {listProblem}
        </p>
      ) : null}
      {quiet
        ? null
        : check.paths.map((problem) => (
            <p
              key={`${problem.index}:${problem.path}`}
              role="alert"
              className="text-xs text-destructive"
            >
              <span className="font-mono">{problem.path}</span>{" "}
              {s.problem.sentence({
                field: "fieldsToKeep",
                code: "invalid_fields_to_keep",
                reason: problem.reason,
                path: problem.path,
              })}
            </p>
          ))}
      <ResponsePicker
        shape={shape}
        args={args}
        onArgs={onArgs}
        chips={chips}
        onChips={setChips}
      />
    </div>
  );
}
