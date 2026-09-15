import { useT } from "@agent-native/core/client/i18n";
import {
  IconVideo,
  IconFolder,
  IconUsersGroup,
  IconArchive,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";
import { type ComponentType, type ReactNode, useState } from "react";
import { Link, useNavigate } from "react-router";

import { ImportLoomDialog } from "@/components/library/import-loom-dialog";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

import { buildLibraryActionHrefs } from "./library-action-hrefs";

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
const BACK_TO_LIBRARY_KINDS = new Set<EmptyKind>([
  "shared",
  "archive",
  "trash",
]);

interface AppEmptyStateProps {
  icon: ComponentType<{ className?: string }>;
  title: ReactNode;
  description?: ReactNode;
  content?: ReactNode;
}

export function AppEmptyState({
  icon: Icon,
  title,
  description,
  content,
}: AppEmptyStateProps) {
  return (
    <Empty className="min-h-64 px-6 py-12 md:p-12">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description ? (
          <EmptyDescription>{description}</EmptyDescription>
        ) : null}
      </EmptyHeader>
      {content ? <EmptyContent>{content}</EmptyContent> : null}
    </Empty>
  );
}

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
  const [loomImportOpen, setLoomImportOpen] = useState(false);

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

  const { recordHref } = buildLibraryActionHrefs({ spaceId, folderId });

  // The empty state offers Import as a single button that opens the Loom
  // import dialog directly — that dialog already exposes "Upload video" too,
  // so a dropdown here would be redundant.
  const content = hasCta ? (
    <div className="flex flex-col items-center gap-2">
      <Button onClick={handleCta} size="sm">
        {t(`empty.${kind}.cta`)}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="gap-2"
        onClick={() => setLoomImportOpen(true)}
      >
        <IconUpload />
        {t("preRecord.import")}
      </Button>
      <ImportLoomDialog
        open={loomImportOpen}
        onOpenChange={setLoomImportOpen}
        spaceId={spaceId}
        folderId={folderId}
        recordHref={recordHref}
      />
    </div>
  ) : BACK_TO_LIBRARY_KINDS.has(kind) ? (
    <Button asChild size="sm" variant="outline">
      <Link to="/library">{t("recordingPage.backToLibrary")}</Link>
    </Button>
  ) : null;

  return (
    <AppEmptyState
      icon={Icon}
      title={t(`empty.${kind}.title`)}
      description={t(`empty.${kind}.body`)}
      content={content}
    />
  );
}
