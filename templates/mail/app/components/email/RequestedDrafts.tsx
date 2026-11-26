import { useT } from "@agent-native/core/client/i18n";
import { IconDots, IconPlus } from "@tabler/icons-react";
import { useState } from "react";
import { Link } from "react-router";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useDraftQueueMembers,
  type QueuedEmailDraft,
} from "@/hooks/use-draft-queue";

import { EmailListSectionHeading } from "./EmailListSectionHeading";
import { QueueDraftDialog } from "./QueueDraftDialog";

export function RequestedDrafts({ drafts }: { drafts: QueuedEmailDraft[] }) {
  const t = useT();
  return (
    <section className="max-h-[40%] shrink-0 overflow-y-auto border-b border-border/30">
      <EmailListSectionHeading
        title={t("mail.draftQueue.requested")}
        count={drafts.length}
      />
      <ul>
        {drafts.map((draft) => (
          <li key={draft.id}>
            <Link
              to={`/draft-queue/${encodeURIComponent(draft.id)}`}
              className="flex h-[48px] items-center gap-3 px-4 text-[13px] transition-colors hover:bg-accent/40 sm:h-[38px]"
            >
              <span className="min-w-0 flex-1 truncate">
                <span data-an-mask className="font-medium text-foreground">
                  {t("mail.draftQueue.askedBy", {
                    name: draft.requesterName || draft.requesterEmail,
                  })}
                </span>{" "}
                <span data-an-mask className="text-muted-foreground">
                  {draft.subject || t("mail.draftQueue.noSubject")}
                </span>
              </span>
              <span className="shrink-0 rounded-full border border-amber-400/30 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-300">
                {t("mail.draftQueue.toReview")}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function DraftsHeaderActions() {
  const t = useT();
  const members = useDraftQueueMembers();
  const [dialogOpen, setDialogOpen] = useState(false);
  if (members.isError) return null;
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        aria-label={t("mail.draftQueue.newDraftRequest")}
        className="hidden h-7 items-center gap-1.5 rounded-md border border-input bg-transparent px-2.5 text-[11px] text-foreground hover:bg-accent/40 sm:flex"
      >
        <IconPlus className="size-3.5" />
        {t("mail.draftQueue.newDraftRequest")}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("mail.draftQueue.moreOptions")}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/40 hover:text-foreground"
          >
            <IconDots className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem
            className="sm:hidden"
            onSelect={() => setDialogOpen(true)}
          >
            {t("mail.draftQueue.newDraftRequest")}
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/draft-queue?scope=requested">
              {t("mail.draftQueue.requestedByMe")}
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <QueueDraftDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        members={members.members}
        currentUser={members.currentUser}
      />
    </div>
  );
}
