import { useT } from "@agent-native/core/client/i18n";
import {
  IconVideo,
  IconFolder,
  IconUsersGroup,
  IconArchive,
  IconTrash,
} from "@tabler/icons-react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

type EmptyKind =
  | "library"
  | "shared"
  | "folder"
  | "space"
  | "archive"
  | "trash"
  | "search";

const ICONS: Record<EmptyKind, React.ComponentType<{ className?: string }>> = {
  library: IconVideo,
  shared: IconUsersGroup,
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
      void navigate(qs ? `/record?${qs}` : "/record");
    }
  };

  return (
    <Empty className="min-h-full rounded-none py-20">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{t(`empty.${kind}.title`)}</EmptyTitle>
        <EmptyDescription>{t(`empty.${kind}.body`)}</EmptyDescription>
      </EmptyHeader>
      {hasCta ? (
        <EmptyContent>
          <Button onClick={handleCta} size="sm">
            {t(`empty.${kind}.cta`)}
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}
