import { useT } from "@agent-native/core/client/i18n";
import { IconUpload, IconX } from "@tabler/icons-react";

import { CommunityAppSubmissionForm } from "./CommunityAppSubmissionForm";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";

export function CommunityAppSubmissionDialog() {
  const t = useT();

  return (
    <Dialog>
      <DialogTrigger className="inline-flex cursor-pointer select-none items-center justify-center gap-[6px] whitespace-nowrap rounded-[var(--b-radius)] border border-solid border-[var(--b-action-secondary-border)] bg-[var(--b-action-secondary-bg)] px-4 py-[10px] font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-1)] font-semibold leading-none tracking-[0.02em] text-[var(--b-action-secondary-text)] no-underline outline-none transition-[background,box-shadow,border-color] duration-150 hover:bg-[var(--b-action-secondary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-text-primary)]">
        {t("templatesPage.submitCommunityTemplate")}
        <IconUpload size={16} />
      </DialogTrigger>
      <DialogContent className="builder-brand-tokens max-h-[calc(100vh-32px)] max-w-[620px] overflow-y-auto border border-solid border-[var(--b-border-default)] bg-[var(--b-bg-page)] p-6 shadow-2xl sm:p-8">
        <div className="flex items-start justify-between gap-6">
          <DialogTitle className="m-0 max-w-[440px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-3)] font-medium leading-[1.1] tracking-[-0.02em] text-[var(--b-text-primary)]">
            {t("templatesPage.communitySubmissionTitle")}
          </DialogTitle>
          <DialogClose asChild>
            <button
              type="button"
              aria-label={t("search.close")}
              className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-[var(--b-radius)] border border-solid border-[var(--b-border-default)] bg-transparent text-[var(--b-text-primary)] outline-none transition-[background,border-color] duration-150 hover:bg-[var(--b-action-secondary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-text-primary)]"
            >
              <IconX size={18} />
            </button>
          </DialogClose>
        </div>
        <DialogDescription className="mt-3 max-w-[520px] font-[family-name:var(--b-font-sans)] text-sm leading-[1.5] text-[var(--b-text-secondary)]">
          {t("templatesPage.communitySubmissionDescription")}
        </DialogDescription>
        <div className="mt-6">
          <CommunityAppSubmissionForm />
        </div>
      </DialogContent>
    </Dialog>
  );
}
