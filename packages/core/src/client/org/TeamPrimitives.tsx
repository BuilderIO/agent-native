import { Button as ToolkitButton } from "@agent-native/toolkit/ui/button";
import { IconHelpCircle } from "@tabler/icons-react";
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { useT } from "../i18n.js";
import { cn } from "../utils.js";

export const Button = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof ToolkitButton>
>(({ className, ...props }, ref) => (
  <ToolkitButton
    ref={ref}
    variant="ghost"
    className={cn(
      "h-auto p-0 hover:bg-transparent active:scale-100 [&_svg]:!size-auto",
      props.emphasis === "solid" ? null : "hover:text-inherit",
      className,
    )}
    {...props}
  />
));
Button.displayName = "TeamPrimitiveButton";

// Radix tooltips throw without a provider, and the exported sections can mount
// outside TeamPage's. Matches TeamPage's delay so nesting inside it is a no-op.
export function SectionTooltipProvider({ children }: { children: ReactNode }) {
  return <TooltipProvider delayDuration={200}>{children}</TooltipProvider>;
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="text-xs text-destructive">
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}

function OrganizationHelpIcon({
  content,
  docsUrl,
}: {
  content: string;
  docsUrl?: string;
}) {
  const t = useT();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          aria-label={t("agentChat.settingsOrg.moreInformation")}
          className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&_svg]:!size-3"
        >
          <IconHelpCircle className="size-3" />
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs leading-5">
        <p>{content}</p>
        {docsUrl ? (
          <a
            href={docsUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block underline underline-offset-2"
          >
            {t("agentChat.settingsOrg.learnMore")}
          </a>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}

export function OrganizationDescription({
  children,
  help,
  docsUrl,
}: {
  children: ReactNode;
  help?: string;
  docsUrl?: string;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      <span>{children}</span>
      {help ? <OrganizationHelpIcon content={help} docsUrl={docsUrl} /> : null}
    </span>
  );
}
