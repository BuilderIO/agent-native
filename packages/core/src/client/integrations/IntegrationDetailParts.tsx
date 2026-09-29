import { Button } from "@agent-native/toolkit/ui/button";
import { IconArrowRight, IconLock } from "@tabler/icons-react";
import { useState, type CSSProperties, type ReactNode } from "react";

import { writeClipboardText } from "../clipboard.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { useT } from "../i18n.js";
import { mcpIntegrationLogoNeedsDarkModeFilter } from "../resources/mcp-integration-logos.js";
import { McpIntegrationLogo } from "../resources/McpIntegrationLogo.js";
import { cn } from "../utils.js";

/**
 * A brand's mark without a frame: a logo image, or a Tabler icon for a
 * service with no logo (Email). Sized by the caller.
 */
export function BrandMark({
  logoUrl,
  logoId,
  icon,
  className,
}: {
  logoUrl: string;
  /** Logo table id, for the dark-mode filter some marks need. */
  logoId?: string;
  icon?: ReactNode;
  className?: string;
}) {
  if (!logoUrl) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-full",
          className,
        )}
      >
        {icon}
      </span>
    );
  }
  return (
    <img
      src={logoUrl}
      alt=""
      aria-hidden="true"
      className={cn(
        "shrink-0 object-contain",
        logoId &&
          mcpIntegrationLogoNeedsDarkModeFilter(logoId) &&
          "dark:invert dark:hue-rotate-180",
        className,
      )}
    />
  );
}

/**
 * A row's leading logo: the framed brand logo, or a soft tile holding a Tabler
 * icon when the service has no logo.
 */
export function BrandLogo({
  name,
  logoUrl,
  logoId,
  icon,
}: {
  name: string;
  logoUrl: string;
  logoId?: string;
  icon?: ReactNode;
}) {
  if (!logoUrl && icon) {
    return (
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&>svg]:size-4"
      >
        {icon}
      </span>
    );
  }
  return (
    <McpIntegrationLogo
      name={name}
      logoUrl={logoUrl}
      integrationId={logoId}
      className="size-8 rounded-md"
      imageClassName="size-[18px]"
    />
  );
}

/** The breadcrumb's current item: the brand mark, then the name. */
export function BreadcrumbTitle({
  name,
  mark,
}: {
  name: string;
  mark: ReactNode;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2 align-bottom">
      {mark}
      <span className="truncate">{name}</span>
    </span>
  );
}

/**
 * The detail page's hero: the brand's mark over a few example prompts on a
 * tint of its color. A prompt asks the agent.
 */
export function IntegrationHero({
  name,
  hue,
  mark,
  heroMark,
  prompts,
  onAsk,
}: {
  name: string;
  hue?: string;
  /** The small mark each prompt starts with. */
  mark: ReactNode;
  /** The large framed mark at the top. */
  heroMark: ReactNode;
  prompts: readonly string[];
  onAsk: (prompt: string) => void;
}) {
  const tint: CSSProperties | undefined = hue
    ? ({
        "--brand": hue,
        backgroundImage:
          "radial-gradient(90% 120% at 0% 0%, color-mix(in srgb, var(--brand) 22%, transparent), transparent 70%), radial-gradient(80% 110% at 100% 100%, color-mix(in srgb, var(--brand) 15%, transparent), transparent 70%)",
      } as CSSProperties)
    : undefined;
  return (
    <section
      data-integration-hero=""
      style={tint}
      className="flex flex-col items-center gap-2 rounded-2xl bg-secondary px-5 pb-8 pt-7"
    >
      <span className="mb-2 flex">{heroMark}</span>
      {prompts.map((prompt) => (
        <button
          key={prompt}
          type="button"
          onClick={() => onAsk(prompt)}
          className="group flex min-h-11 w-full max-w-[540px] items-center gap-2 rounded-xl border border-border/60 bg-card/80 py-[7px] pe-[7px] ps-3 text-start text-[13.5px] text-foreground transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="inline-flex shrink-0 items-center gap-1.5 font-medium">
            {mark}
            {name}
          </span>
          <span className="min-w-0 flex-1">{prompt}</span>
          <span
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground group-hover:text-foreground"
          >
            <IconArrowRight className="size-4 rtl:-scale-x-100" />
          </span>
        </button>
      ))}
    </section>
  );
}

/** A read-only value at the end of a row. */
export function RowValue({ children }: { children: ReactNode }) {
  return (
    <span className="whitespace-nowrap text-sm text-muted-foreground">
      {children}
    </span>
  );
}

/** A value the viewer can't change, with a lock and who can. */
export function LockedValue({
  value,
  reason,
}: {
  value: string;
  reason: string;
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-muted-foreground"
          >
            {value}
            <IconLock className="size-3.5" aria-hidden="true" />
          </span>
        </TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** A URL to copy, as the row's control. */
export function CopyField({ value, label }: { value: string; label: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex h-8 w-full min-w-0 max-w-[420px] items-center gap-2 rounded-md border border-border bg-muted/50 pe-1 ps-2.5">
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
        {value}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        aria-label={label}
        onClick={async () => {
          if (await writeClipboardText(value)) {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }
        }}
      >
        {copied ? t("agentChat.common.copied") : t("agentChat.common.copy")}
      </Button>
    </div>
  );
}
