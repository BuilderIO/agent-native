import { IconArrowLeft } from "@tabler/icons-react";
import { forwardRef } from "react";

import { desktopRecoveryCopy } from "../i18n/en-US";

export const BackToApp = forwardRef<HTMLButtonElement, { onClick: () => void }>(
  function BackToApp({ onClick }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-base font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onClick={onClick}
      >
        <IconArrowLeft
          className="size-4 shrink-0"
          stroke={1.85}
          aria-hidden="true"
        />
        {desktopRecoveryCopy.backToApp}
      </button>
    );
  },
);
