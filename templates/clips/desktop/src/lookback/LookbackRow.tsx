import { useT } from "@agent-native/core/client/i18n";
import { IconChevronDown, IconHistory } from "@tabler/icons-react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { type FormEvent, useRef, useState } from "react";

import {
  lookbackLabel,
  SCREEN_HISTORY_PRESETS,
} from "../../../shared/screen-history-context";
import { Button } from "../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Input } from "../components/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { useRowMenu } from "../components/useRowMenu";
import {
  type LookbackCustomError,
  type LookbackUnit,
  parseLookbackCustomInput,
} from "./lookback-settings";

const LOOKBACK_HELP_URL =
  "https://www.agent-native.com/docs/template-clips-features#earlier-screen-time";

export interface LookbackRowProps {
  seconds: number;
  recentSeconds: number[];
  rewindOn: boolean;
  disabled?: boolean;
  onSecondsChange: (seconds: number) => void;
  onTurnOnRewind: () => void;
  openUrl?: (url: string) => Promise<void>;
}

export function LookbackRow({
  seconds,
  recentSeconds,
  rewindOn,
  disabled = false,
  onSecondsChange,
  onTurnOnRewind,
  openUrl = openExternal,
}: LookbackRowProps) {
  const t = useT();
  const { open, onOpenChange } = useRowMenu();
  const [customOpen, setCustomOpen] = useState(false);
  const [rewindOffOpen, setRewindOffOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState<LookbackUnit>("seconds");
  const [customError, setCustomError] = useState<LookbackCustomError | null>(
    null,
  );
  // Set by Custom…; the input opens once the menu has released focus.
  const customRequestedRef = useRef(false);

  const shownSeconds = rewindOn ? seconds : 0;
  const valueLabel =
    shownSeconds > 0 ? lookbackLabel(shownSeconds) : t("lookbackContext.off");
  const customErrorText = customError
    ? {
        empty: t("lookbackContext.customErrorEmpty"),
        invalid: t("lookbackContext.customErrorInvalid"),
        "too-long": t("lookbackContext.customErrorTooLong"),
      }[customError]
    : null;

  // Opening the popover here would mount it while the menu still holds focus,
  // and Radix then dismisses it at once as a focus-outside event.
  function openCustom() {
    customRequestedRef.current = true;
    setAmount("");
    setCustomError(null);
  }

  function submitCustom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = parseLookbackCustomInput(amount, unit);
    if (!result.ok) {
      setCustomError(result.error);
      return;
    }
    setCustomError(null);
    setCustomOpen(false);
    onSecondsChange(result.seconds);
  }

  function openHelp() {
    void openUrl(LOOKBACK_HELP_URL).catch((err) => {
      console.error("[clips-lookback] open help failed:", err);
    });
  }

  const trigger = (
    <button
      type="button"
      className="row-button disabled:pointer-events-none disabled:opacity-50"
      disabled={disabled}
      aria-label={`${t("lookbackContext.includeLast")}: ${valueLabel}`}
    >
      <span className="row-label">{t("lookbackContext.includeLast")}</span>
      <span className="row-flex" aria-hidden />
      <span className="shrink-0 text-xs text-[var(--fg-subtle)]">
        {valueLabel}
      </span>
      <IconChevronDown
        className="row-chev"
        size={16}
        stroke={1.75}
        aria-hidden
      />
    </button>
  );

  // With Rewind off the value cannot change, so the trigger explains the
  // feature instead of offering the presets.
  const control = rewindOn ? (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        data-popover-resize-overlay="true"
        className="recorder-menu w-[216px] rounded-[10px]"
        onCloseAutoFocus={(event) => {
          // Runs once the menu has unmounted. Keeping focus here stops Radix
          // from returning it to the trigger over the custom input.
          if (!customRequestedRef.current) return;
          customRequestedRef.current = false;
          event.preventDefault();
          setCustomOpen(true);
        }}
      >
        <DropdownMenuRadioGroup
          value={String(shownSeconds)}
          onValueChange={(value) => onSecondsChange(Number(value))}
        >
          <DropdownMenuRadioItem value="0">
            {t("lookbackContext.off")}
          </DropdownMenuRadioItem>
          {SCREEN_HISTORY_PRESETS.map((preset) => (
            <DropdownMenuRadioItem key={preset} value={String(preset)}>
              {lookbackLabel(preset)}
            </DropdownMenuRadioItem>
          ))}
          {recentSeconds.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              {recentSeconds.map((recent) => (
                <DropdownMenuRadioItem key={recent} value={String(recent)}>
                  {lookbackLabel(recent)}
                </DropdownMenuRadioItem>
              ))}
            </>
          ) : null}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem inset onSelect={openCustom}>
          {t("lookbackContext.custom")}
        </DropdownMenuItem>
        <DropdownMenuItem inset onSelect={openHelp}>
          {t("lookbackContext.whatIsThis")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : (
    <Popover open={rewindOffOpen} onOpenChange={setRewindOffOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        data-popover-resize-overlay="true"
        className="w-[248px] p-3"
      >
        <div className="grid gap-2">
          <span className="text-xs font-medium">
            {t("lookbackContext.rewindOffTitle")}
          </span>
          <p className="text-xs text-[var(--fg-subtle)]">
            {t("lookbackContext.rewindOffBody")}
          </p>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setRewindOffOpen(false);
              onTurnOnRewind();
            }}
          >
            {t("lookbackContext.turnOnRewind")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="justify-self-start px-0"
            onClick={() => {
              setRewindOffOpen(false);
              openHelp();
            }}
          >
            {t("lookbackContext.whatIsThis")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );

  return (
    <Popover open={customOpen} onOpenChange={setCustomOpen}>
      <PopoverAnchor asChild>
        <div className={`row ${disabled ? "row-off" : "row-on"} gap-2`}>
          <span className="row-icon" aria-hidden>
            <IconHistory size={20} stroke={1.75} />
          </span>
          {control}
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        data-popover-resize-overlay="true"
        className="w-[248px] p-3"
      >
        <form className="grid gap-2" onSubmit={submitCustom}>
          <span className="text-xs font-medium">
            {t("lookbackContext.customLabel")}
          </span>
          <div className="flex items-center gap-2">
            <Input
              aria-label={t("lookbackContext.customAmount")}
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                setCustomError(null);
              }}
              className="h-8 w-20"
            />
            <Select
              value={unit}
              onValueChange={(next) => setUnit(next as LookbackUnit)}
            >
              <SelectTrigger
                aria-label={t("lookbackContext.customUnit")}
                className="h-8 flex-1"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="seconds">
                  {t("lookbackContext.unitSeconds")}
                </SelectItem>
                <SelectItem value="minutes">
                  {t("lookbackContext.unitMinutes")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {customErrorText ? (
            <p role="alert" className="text-xs text-destructive">
              {customErrorText}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCustomOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" size="sm">
              {t("lookbackContext.customSave")}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
