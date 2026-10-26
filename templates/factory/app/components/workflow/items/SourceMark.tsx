import {
  IconBrandGithub,
  IconBrandSentry,
  IconBrandSlack,
  IconDatabase,
  IconMail,
  IconPlug,
  type Icon,
} from "@tabler/icons-react";

import { cn } from "@/lib/utils";

import { useItemsStrings } from "../items-strings";
import { sourceLabel } from "./item-status";

const SOURCE_ICONS: Record<string, Icon> = {
  slack: IconBrandSlack,
  github: IconBrandGithub,
  github_issue: IconBrandGithub,
  sentry: IconBrandSentry,
  email: IconMail,
  bigquery: IconDatabase,
  posthog: IconDatabase,
};

/** The provider's mark, or a neutral plug for a provider with no mark of its own. */
export function SourceMark({
  source,
  className,
}: {
  source: string | null;
  className?: string;
}) {
  const s = useItemsStrings();
  const label = sourceLabel(source, s);
  const SourceIcon = (source && SOURCE_ICONS[source]) || IconPlug;
  return (
    <SourceIcon
      className={cn("size-4 shrink-0 text-muted-foreground", className)}
      role={label ? "img" : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
    />
  );
}
