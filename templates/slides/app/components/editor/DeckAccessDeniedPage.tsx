import { useT } from "@agent-native/core/client/i18n";
import { AgentNativeIcon } from "@agent-native/core/client/ui";
import { SLIDES_ACCESS_REQUEST_NOTE_MAX_LENGTH } from "@shared/deck-access";
import {
  IconCheck,
  IconExclamationCircle,
  IconLoader2,
  IconLock,
} from "@tabler/icons-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { DeckAccessRequestState } from "@/lib/deck-editor-loading";

const PAGE_BUTTON_CLASS =
  "h-10 shrink-0 gap-1 px-5 font-mono text-sm font-semibold uppercase tracking-[0.02em]";

export function DeckAccessDeniedPage({
  canRequestAccess,
  request,
  savedNote,
  viewerEmail,
  onNoteChange,
  onRequestAccess,
  onSwitchAccount,
  onGoHome,
}: {
  canRequestAccess: boolean;
  request: DeckAccessRequestState;
  /** The note on a request already on record, shown read-only. */
  savedNote: string | null;
  viewerEmail: string | null;
  onNoteChange: () => void;
  onRequestAccess: (note: string) => void;
  onSwitchAccount: () => void;
  onGoHome: () => void;
}) {
  const t = useT();
  const [note, setNote] = useState("");
  const { status } = request;
  const locked = status === "pending" || status === "sent";
  const description =
    request.status === "sent"
      ? t(
          request.ownerNotified
            ? "deckAccessPage.requestSentDescription"
            : "deckEditor.accessRequestRecordedDescription",
        )
      : t("deckAccessPage.noAccessDescription");

  const submitRequest = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onRequestAccess(note);
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex h-24 shrink-0 items-center px-4 sm:px-14">
        <span className="flex items-center gap-2 text-foreground">
          <AgentNativeIcon size={28} />
          <span className="text-lg font-bold uppercase tracking-tight">
            Agent-Native
          </span>
        </span>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <form
          onSubmit={submitRequest}
          className="flex w-full max-w-[875px] flex-col items-center gap-3"
        >
          <div className="flex flex-col items-center gap-7">
            <div className="flex size-[68px] items-center justify-center rounded-xl border border-border bg-card">
              <IconLock className="size-9" />
            </div>
            <p className="font-mono text-sm font-medium uppercase leading-5 text-muted-foreground">
              {t("deckAccessPage.errorCode")}
            </p>
          </div>
          <div className="flex w-full flex-col items-center gap-10">
            <div className="flex flex-col items-center gap-2 text-center">
              <h1 className="text-4xl font-medium leading-[1.05] tracking-[-0.02em] sm:text-[56px]">
                {t("deckAccessPage.noAccessTitle")}
              </h1>
              <p className="max-w-xl text-base leading-[1.3] text-muted-foreground sm:text-lg">
                {description}
              </p>
            </div>
            <div className="flex w-full flex-col items-center gap-6">
              {canRequestAccess ? (
                <div className="flex w-full max-w-[287px] flex-col gap-2 py-[3px]">
                  <Label
                    htmlFor="deck-access-request-note"
                    className="text-[13px] font-normal leading-5 text-muted-foreground"
                  >
                    {t("deckAccessPage.noteLabel")}
                  </Label>
                  <Textarea
                    id="deck-access-request-note"
                    value={savedNote ?? note}
                    onChange={(event) => {
                      setNote(event.target.value);
                      onNoteChange();
                    }}
                    placeholder={t("deckAccessPage.notePlaceholder")}
                    maxLength={SLIDES_ACCESS_REQUEST_NOTE_MAX_LENGTH}
                    disabled={locked}
                    className="h-[66px] min-h-0 resize-none rounded-sm px-2 py-1.5 text-xs"
                  />
                  {status === "failed" ? (
                    <p
                      role="alert"
                      className="flex items-center gap-2 text-xs text-destructive"
                    >
                      <IconExclamationCircle className="size-[18px] shrink-0" />
                      {t("deckAccessPage.requestFailed")}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className="flex items-center justify-center gap-6">
                {canRequestAccess ? (
                  <Button
                    type="submit"
                    disabled={locked}
                    className={PAGE_BUTTON_CLASS}
                  >
                    {status === "pending" ? (
                      <>
                        <IconLoader2 className="size-4 animate-spin" />
                        {t("deckAccessPage.requesting")}
                      </>
                    ) : status === "sent" ? (
                      <>
                        <IconCheck className="size-4" />
                        {t("deckEditor.accessRequestSent")}
                      </>
                    ) : (
                      t("deckEditor.requestAccess")
                    )}
                  </Button>
                ) : null}
                {/* The toolkit outline variant is filled; the design's
                    secondary button is bordered and transparent. */}
                <Button
                  type="button"
                  onClick={onGoHome}
                  className={`${PAGE_BUTTON_CLASS} border border-muted-foreground bg-transparent text-foreground hover:bg-accent`}
                >
                  {t("deckAccessPage.goHome")}
                </Button>
              </div>
            </div>
          </div>
        </form>
      </main>
      {viewerEmail ? (
        <footer className="flex justify-center px-4 pb-16 pt-6">
          <p className="text-center font-mono text-sm font-medium leading-5 text-muted-foreground">
            {t("deckAccessPage.signedInAs")}{" "}
            <span className="text-foreground">{viewerEmail}</span>
            {" | "}
            <button
              type="button"
              onClick={onSwitchAccount}
              className="text-foreground underline underline-offset-2 hover:text-foreground/80"
            >
              {t("deckAccessPage.switchAccount")}
            </button>
          </p>
        </footer>
      ) : null}
    </div>
  );
}
