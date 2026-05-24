import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Icon } from "@tabler/icons-react";
import {
  IconAlertTriangle,
  IconDatabase,
  IconKey,
  IconTestPipe,
} from "@tabler/icons-react";

/**
 * Per-file signal a `pr-file-tree.tsx` row displays next to a filename.
 *
 * Symbols are intentionally small + monochrome so a row of badges reads
 * like a status row, not a row of decorative chips. Tone classes match the
 * project's badge variants so we don't introduce a new color palette.
 */
export type PRFileBadgeKind = "tests" | "lint" | "secrets" | "schema";

interface PRFileBadgeProps {
  kind: PRFileBadgeKind;
  /** Hover/screen-reader text. Defaults to a sensible label per kind. */
  label?: string;
  className?: string;
}

const REGISTRY: Record<
  PRFileBadgeKind,
  { icon: Icon; defaultLabel: string; tone: string }
> = {
  tests: {
    icon: IconTestPipe,
    defaultLabel: "Touches tests",
    tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  lint: {
    icon: IconAlertTriangle,
    defaultLabel: "Lint warning",
    tone: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  secrets: {
    icon: IconKey,
    defaultLabel: "Touches secret-handling code",
    tone: "bg-red-500/10 text-red-700 dark:text-red-300",
  },
  schema: {
    icon: IconDatabase,
    defaultLabel: "Touches schema / migration",
    tone: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
};

export function PRFileBadge({ kind, label, className }: PRFileBadgeProps) {
  const entry = REGISTRY[kind];
  const Icon = entry.icon;
  const text = label ?? entry.defaultLabel;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex size-5 items-center justify-center rounded-sm",
            entry.tone,
            className,
          )}
          aria-label={text}
        >
          <Icon size={12} aria-hidden />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

/** Heuristic badges derived from a file's path. Mirrors `summarize-pr`. */
export function badgesForFile(path: string): PRFileBadgeKind[] {
  const out: PRFileBadgeKind[] = [];
  if (
    /\.(test|spec)\.[tj]sx?$/.test(path) ||
    /\/__tests__\//.test(path) ||
    /\/tests?\//.test(path)
  ) {
    out.push("tests");
  }
  if (
    /(^|\/)schema(\.[tj]sx?)?$/i.test(path) ||
    /\/migrations\//.test(path) ||
    /\.sql$/i.test(path) ||
    /\/drizzle\//.test(path)
  ) {
    out.push("schema");
  }
  if (/(secret|password|token|credential|vault|\.env)/i.test(path)) {
    out.push("secrets");
  }
  return out;
}
