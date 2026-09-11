import {
  IconFile,
  IconFileCode,
  IconFileTypeCss,
  IconFileTypeHtml,
  IconFileTypeJs,
  IconFileTypeJsx,
  IconFileTypeTs,
  IconFileTypeTsx,
  IconFolder,
  IconFolderOpen,
  IconJson,
  IconMarkdown,
  IconPhoto,
} from "@tabler/icons-react";

import { cn } from "@/lib/utils";

/**
 * File-type icon for explorer rows, tabs, breadcrumbs, and search results.
 * Tabler icons only, colored per language family using workbench vars where
 * a semantic mapping exists (falls back to muted foreground otherwise).
 */
export function FileIcon({
  path,
  className,
}: {
  path: string;
  className?: string;
}) {
  const common = cn("size-3.5 shrink-0", className);
  const extension = path.split(".").pop()?.toLowerCase() ?? "";

  switch (extension) {
    case "html":
    case "htm":
    case "vue":
    case "svelte":
    case "astro":
      return (
        <IconFileTypeHtml className={cn(common, "text-[hsl(213_75%_50%)]")} />
      );
    case "css":
    case "scss":
    case "less":
      return (
        <IconFileTypeCss className={cn(common, "text-[hsl(263_55%_58%)]")} />
      );
    case "js":
    case "mjs":
    case "cjs":
      return (
        <IconFileTypeJs className={cn(common, "text-[hsl(48_90%_48%)]")} />
      );
    case "jsx":
      return (
        <IconFileTypeJsx className={cn(common, "text-[hsl(199_85%_50%)]")} />
      );
    case "ts":
      return (
        <IconFileTypeTs className={cn(common, "text-[hsl(213_75%_50%)]")} />
      );
    case "tsx":
      return (
        <IconFileTypeTsx className={cn(common, "text-[hsl(213_75%_50%)]")} />
      );
    case "json":
      return <IconJson className={cn(common, "text-[hsl(28_70%_55%)]")} />;
    case "md":
    case "mdx":
      return (
        <IconMarkdown
          className={cn(common, "text-[var(--workbench-muted-fg)]")}
        />
      );
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
    case "webp":
    case "ico":
      return <IconPhoto className={cn(common, "text-[hsl(140_45%_45%)]")} />;
    case "yml":
    case "yaml":
      return (
        <IconFileCode
          className={cn(common, "text-[var(--workbench-muted-fg)]")}
        />
      );
    default:
      return (
        <IconFile className={cn(common, "text-[var(--workbench-muted-fg)]")} />
      );
  }
}

/** Explorer folder glyph — open when expanded, closed otherwise. */
export function FolderIcon({
  open,
  className,
}: {
  open: boolean;
  className?: string;
}) {
  const common = cn(
    "size-3.5 shrink-0 text-[var(--workbench-accent)]",
    className,
  );
  return open ? (
    <IconFolderOpen className={common} />
  ) : (
    <IconFolder className={common} />
  );
}
