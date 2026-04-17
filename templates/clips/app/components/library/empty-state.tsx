import { useNavigate } from "react-router";
import {
  IconVideo,
  IconFolder,
  IconUsersGroup,
  IconArchive,
  IconTrash,
  IconPlayerRecord,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";

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

const COPY: Record<EmptyKind, { title: string; body: string; cta?: string }> = {
  library: {
    title: "Your library is empty",
    body: "Capture your first screen recording and it'll land here, ready to share.",
    cta: "Record your first Loom",
  },
  folder: {
    title: "This folder is empty",
    body: "Drag recordings in, or hit record to start something new in this folder.",
    cta: "Record here",
  },
  space: {
    title: "No recordings in this space yet",
    body: "Share a recording with the space or record something new — your team will see it here.",
    cta: "Record for this space",
  },
  archive: {
    title: "Nothing archived",
    body: "Archived recordings are hidden from the library but kept safe. You can always restore them later.",
  },
  trash: {
    title: "Trash is empty",
    body: "Deleted recordings appear here for 30 days before being permanently removed.",
  },
  search: {
    title: "No matches",
    body: "Try a different search term or check your filters.",
  },
};

interface EmptyStateProps {
  kind: EmptyKind;
  onCtaClick?: () => void;
}

export function EmptyState({ kind, onCtaClick }: EmptyStateProps) {
  const navigate = useNavigate();
  const Icon = ICONS[kind];
  const copy = COPY[kind];

  const handleCta = () => {
    if (onCtaClick) {
      onCtaClick();
    } else {
      navigate("/record");
    }
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center py-20 px-8 text-center">
      <div
        className="relative mb-6 flex h-20 w-20 items-center justify-center rounded-2xl"
        style={{
          background:
            "linear-gradient(135deg, rgba(98,93,245,0.15), rgba(98,93,245,0.05))",
          boxShadow: "0 1px 2px rgba(98,93,245,0.1)",
        }}
      >
        <Icon className="h-10 w-10 text-[#625DF5]" />
      </div>
      <h2 className="text-base font-semibold text-foreground mb-1">
        {copy.title}
      </h2>
      <p className="text-sm text-muted-foreground max-w-sm mb-5">{copy.body}</p>
      {copy.cta && (
        <Button
          onClick={handleCta}
          className="bg-[#625DF5] text-white hover:bg-[#554FE5] gap-1.5"
          size="sm"
        >
          <IconPlayerRecord className="h-4 w-4" />
          {copy.cta}
        </Button>
      )}
    </div>
  );
}
