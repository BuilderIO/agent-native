import { useT } from "@agent-native/core/client/i18n";
import { NFM_BASE_COLORS } from "@shared/nfm";
import { IconPalette } from "@tabler/icons-react";

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

import { instantCloseMenuClass, menuIconClass } from "./menu-classes";

const DEFAULT_TEXT = "default";
const DEFAULT_BACKGROUND = "default_bg";

/** The colour a choice leaves. A default clears only its own kind of colour. */
export function chosenColor(current: string | null, choice: string) {
  const background = !!current?.endsWith("_bg");
  if (choice === DEFAULT_TEXT) return background ? current : null;
  if (choice === DEFAULT_BACKGROUND) return background ? null : current;
  return choice;
}

/**
 * A Color submenu for something that takes one block colour: `blue` for blue
 * text, `blue_bg` for a blue background, or null for neither.
 */
export function ColorSubmenu({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (color: string | null) => void;
}) {
  const t = useT();
  const choice = (color: string, label: string) => {
    const name = color.replace(/_bg$/, "");
    const background = color.endsWith("_bg");
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
        {background ? (
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
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="gap-2">
        <IconPalette className={menuIconClass} />
        {t("editor.color.label")}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        className={cn(
          "max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto",
          instantCloseMenuClass,
        )}
        collisionPadding={8}
      >
        <DropdownMenuRadioGroup
          value={value ?? DEFAULT_TEXT}
          onValueChange={(next) => onChange(chosenColor(value, next))}
        >
          <DropdownMenuLabel>{t("editor.textColor")}</DropdownMenuLabel>
          {choice(DEFAULT_TEXT, t("editor.color.defaultText"))}
          {NFM_BASE_COLORS.map((name) =>
            choice(
              name,
              t("editor.color.textChoice", {
                color: t(`editor.color.${name}`),
              }),
            ),
          )}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{t("editor.backgroundColor")}</DropdownMenuLabel>
          {choice(DEFAULT_BACKGROUND, t("editor.color.defaultBackground"))}
          {NFM_BASE_COLORS.map((name) =>
            choice(
              `${name}_bg`,
              t("editor.color.backgroundChoice", {
                color: t(`editor.color.${name}`),
              }),
            ),
          )}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
