import { useT } from "@agent-native/core/client/i18n";
import { IconFolderOpen } from "@tabler/icons-react";
import { Link } from "react-router";

import { cn } from "@/lib/utils";

interface FolderCardProps {
  folder: {
    id: string;
    name: string;
  };
  href: string;
}

export function FolderCard({ folder, href }: FolderCardProps) {
  const t = useT();

  return (
    <Link
      to={href}
      aria-label={`${folder.name} — ${t("navigation.folder")}`}
      className={cn(
        "group flex h-14 min-w-0 items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-2.5 text-start",
        "shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-primary/40 hover:bg-accent/20",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      )}
    >
      <IconFolderOpen className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:scale-105 motion-reduce:transition-none" />
      <span className="min-w-0 truncate text-sm font-medium text-foreground">
        {folder.name}
      </span>
    </Link>
  );
}
