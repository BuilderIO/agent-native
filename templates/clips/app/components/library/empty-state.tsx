import { useT } from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  IconVideo,
  IconFolder,
  IconUsersGroup,
  IconArchive,
  IconTrash,
  IconPlayerRecord,
} from "@tabler/icons-react";
import { useNavigate } from "react-router";

type EmptyKind =
  | "library"
  | "folder"
  | "space"
  | "archive"
  | "trash"
  | "search";

const ICONS: Record<EmptyKind, React.ComponentType<{ className?: string }>> = {
  library: IconVideo,
  folder: IconFolder,
  space: IconUsersGroup,
  archive: IconArchive,
  trash: IconTrash,
  search: IconVideo,
};

const CTA_KINDS = new Set<EmptyKind>(["library", "folder", "space"]);

interface EmptyStateProps {
  kind: EmptyKind;
  spaceId?: string | null;
  folderId?: string | null;
  onCtaClick?: () => void;
}

export function EmptyState({
  kind,
  spaceId,
  folderId,
  onCtaClick,
}: EmptyStateProps) {
  const navigate = useNavigate();
  const t = useT();
  const Icon = ICONS[kind];
  const hasCta = CTA_KINDS.has(kind);

  const handleCta = () => {
    if (onCtaClick) {
      onCtaClick();
    } else {
      const params = new URLSearchParams();
      if (spaceId) params.set("spaceId", spaceId);
      if (folderId) params.set("folderId", folderId);
      const qs = params.toString();
      navigate(qs ? `/record?${qs}` : "/record");
    }
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center py-20 px-8 text-center">
      <div className="relative mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 shadow-md">
        <Icon className="h-10 w-10 text-primary" />
      </div>
      <h2 className="text-base font-semibold text-foreground mb-1">
        {t(`empty.${kind}.title`)}
      </h2>
      <p className="text-sm text-muted-foreground max-w-sm mb-5">
        {t(`empty.${kind}.body`)}
      </p>
      {hasCta && (
        <Button
          onClick={handleCta}
          className="bg-primary text-primary-foreground hover:bg-primary/90 gap-1.5"
          size="sm"
        >
          <IconPlayerRecord className="h-4 w-4" />
          {t(`empty.${kind}.cta`)}
        </Button>
      )}
    </div>
  );
}
