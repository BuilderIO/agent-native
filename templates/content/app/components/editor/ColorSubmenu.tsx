import { useT } from "@agent-native/core/client/i18n";
import { NFM_BASE_COLORS } from "@shared/nfm";

import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { instantCloseMenuClass } from "./menu-classes";

const DEFAULT_TEXT = "default";
const DEFAULT_BACKGROUND = "default_bg";

/** The colour a choice leaves. A default clears only its own kind of colour. */
export function chosenColor(current: string | null, choice: string) {
  const background = !!current?.endsWith("_bg");
  if (choice === DEFAULT_TEXT) return background ? current : null;
  if (choice === DEFAULT_BACKGROUND) return background ? null : current;
  return choice;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;
type ColorChoice = { color: string; label: string };

/** Each colour a block can take, by group, with its label. */
export function blockColorChoices(t: Translate): {
  text: ColorChoice[];
  background: ColorChoice[];
} {
  const named = (key: string, suffix: string) =>
    NFM_BASE_COLORS.map((name) => ({
      color: `${name}${suffix}`,
      label: t(key, { color: t(`editor.color.${name}`) }),
    }));
  return {
    text: [
      { color: DEFAULT_TEXT, label: t("editor.color.defaultText") },
      ...named("editor.color.textChoice", ""),
    ],
    background: [
      { color: DEFAULT_BACKGROUND, label: t("editor.color.defaultBackground") },
      ...named("editor.color.backgroundChoice", "_bg"),
    ],
  };
}

/**
 * The block colours as radio items under their group labels, leaving out any
 * whose label `shows` refuses.
 */
export function ColorChoices({
  value,
  onChange,
  shows = () => true,
}: {
  value: string | null;
  onChange: (color: string | null) => void;
  shows?: (label: string) => boolean;
}) {
  const t = useT();
  const choices = blockColorChoices(t);
  const text = choices.text.filter(({ label }) => shows(label));
  const background = choices.background.filter(({ label }) => shows(label));
  const choice = ({ color, label }: ColorChoice) => {
    const name = color.replace(/_bg$/, "");
    const isBackground = color.endsWith("_bg");
    const isDefault = name === DEFAULT_TEXT;
    return (
      <DropdownMenuRadioItem
        key={color}
        className="gap-2"
        indicator="check"
        // Type-to-find would otherwise read the text swatch's "A" first.
        textValue={label}
        value={color}
      >
        {isBackground ? (
          <span
            aria-hidden="true"
            className={cn(
              "size-5 shrink-0 rounded border border-border",
              !isDefault && `content-block-bg--${name}`,
            )}
          />
        ) : (
          <span
            aria-hidden="true"
            className={cn(
              "flex size-5 shrink-0 items-center justify-center rounded border border-border text-xs font-semibold",
              !isDefault && `content-block-color--${name}`,
            )}
          >
            A
          </span>
        )}
        {label}
      </DropdownMenuRadioItem>
    );
  };

  return (
    <DropdownMenuRadioGroup
      value={value ?? DEFAULT_TEXT}
      onValueChange={(next) => onChange(chosenColor(value, next))}
    >
      {text.length > 0 ? (
        <>
          <DropdownMenuLabel>{t("editor.textColor")}</DropdownMenuLabel>
          {text.map(choice)}
        </>
      ) : null}
      {text.length > 0 && background.length > 0 ? (
        <DropdownMenuSeparator />
      ) : null}
      {background.length > 0 ? (
        <>
          <DropdownMenuLabel>{t("editor.backgroundColor")}</DropdownMenuLabel>
          {background.map(choice)}
        </>
      ) : null}
    </DropdownMenuRadioGroup>
  );
}

/**
 * A Color submenu for something that takes one block colour: `blue` for blue
 * text, `blue_bg` for a blue background, or null for neither.
 */
export function ColorSubmenu({
  value,
  onChange,
  onEscapeKeyDown,
}: {
  value: string | null;
  onChange: (color: string | null) => void;
  onEscapeKeyDown?: () => void;
}) {
  const t = useT();
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="gap-2">
        {t("editor.color.label")}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        className={cn(
          "max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto",
          instantCloseMenuClass,
        )}
        collisionPadding={8}
        onEscapeKeyDown={onEscapeKeyDown}
      >
        <ColorChoices value={value} onChange={onChange} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
