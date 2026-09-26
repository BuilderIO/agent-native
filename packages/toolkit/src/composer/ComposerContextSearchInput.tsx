import { IconArrowLeft } from "@tabler/icons-react";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { Button } from "../ui/button.js";
import { CommandInput } from "../ui/command.js";
import { useComposerRuntimeAdapters } from "./runtime-adapters.js";

export interface ComposerContextSearchInputProps extends Omit<
  ComponentPropsWithoutRef<typeof CommandInput>,
  "leading"
> {
  onBack?: () => void;
}

export const ComposerContextSearchInput = forwardRef<
  HTMLInputElement,
  ComposerContextSearchInputProps
>(({ onBack, ...props }, ref) => {
  const t = useComposerRuntimeAdapters().translate!;
  return (
    <CommandInput
      {...props}
      ref={ref}
      leading={
        onBack ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="-ms-2 size-8 shrink-0"
            aria-label={t("agentChat.composer.contextBack", {
              defaultValue: "Back",
            })}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ")
                event.stopPropagation();
            }}
            onClick={onBack}
          >
            <IconArrowLeft />
          </Button>
        ) : undefined
      }
    />
  );
});
ComposerContextSearchInput.displayName = "ComposerContextSearchInput";
