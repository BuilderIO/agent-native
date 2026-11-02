import { appPath } from "@agent-native/core/client/api-path";
import {
  actionErrorMessage,
  signOut,
  useSession,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { buildSignInReturnHref } from "@agent-native/core/client/sign-in-return";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";

import { DeckAccessDeniedPage } from "@/components/editor/DeckAccessDeniedPage";
import { MissingDeckAccessPane } from "@/components/editor/MissingDeckAccessPane";
import {
  useDeckAccessStatus,
  useRequestDeckAccess,
} from "@/hooks/use-deck-access";
import { deckAccessRequestStateFor } from "@/lib/deck-editor-loading";

/**
 * What a presentation link shows someone who can't open the deck. A request
 * sent from here asks to view, because a presentation link only presents.
 */
export function PresentationAccessGate({
  deckId,
  onReload,
}: {
  deckId: string;
  onReload: () => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const { session, isLoading: sessionLoading } = useSession();
  const statusQuery = useDeckAccessStatus(deckId);
  const request = useRequestDeckAccess();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [requesterEmail, setRequesterEmail] = useState("");
  const status = statusQuery.data ?? null;
  const signInHref = buildSignInReturnHref({
    returnTo: appPath(`/p/${encodeURIComponent(deckId)}`),
  });

  const submitRequest = async (input: { note?: string; email?: string }) => {
    setDialogError(null);
    let accessRequestToken: string | undefined;
    if (input.email) {
      // A guest request needs a fresh capability from the access probe.
      const refreshed = await statusQuery.refetch();
      accessRequestToken = refreshed.data?.accessRequestToken;
      if (!accessRequestToken) {
        setDialogError(t("deckEditor.accessRequestFailed"));
        return;
      }
    }
    request.mutate(
      {
        deckId,
        role: "viewer",
        ...(input.note ? { note: input.note } : {}),
        ...(input.email ? { requesterEmail: input.email } : {}),
        ...(accessRequestToken ? { accessRequestToken } : {}),
      },
      {
        onSuccess: (result) => {
          if (input.email) setDialogOpen(false);
          if (result.alreadyHasAccess) onReload();
        },
        onError: (error: unknown) => {
          if (!input.email) return;
          setDialogError(
            actionErrorMessage(error) ?? t("deckEditor.accessRequestFailed"),
          );
        },
      },
    );
  };

  if (session && status?.exists && !status.hasAccess) {
    const pendingAccessRequest = status.pendingAccessRequest;
    return (
      <DeckAccessDeniedPage
        key={deckId}
        canRequestAccess={status.visibility === "private"}
        request={deckAccessRequestStateFor(request, pendingAccessRequest)}
        savedNote={pendingAccessRequest?.note ?? null}
        viewerEmail={session.email}
        onNoteChange={() => {
          if (request.isError) request.reset();
        }}
        onRequestAccess={(note) => void submitRequest({ note })}
        onSwitchAccount={() => void signOut()}
        onGoHome={() => void navigate("/home")}
      />
    );
  }

  return (
    <MissingDeckAccessPane
      accessStatus={status}
      accessStatusError={statusQuery.isError}
      accessStatusLoading={sessionLoading || statusQuery.isLoading}
      hasTeamJoinOption={false}
      orgLoading={false}
      orgError={false}
      requestAccessPending={request.isPending || statusQuery.isFetching}
      accessRequestSent={request.isSuccess}
      accessRequestNotified={request.data?.notifiedOwner === true}
      requestAccessDialogOpen={dialogOpen}
      requesterEmail={requesterEmail}
      requestAccessDialogError={dialogError}
      signedIn={Boolean(session)}
      signInHref={signInHref}
      viewerEmail={session?.email ?? status?.viewerEmail ?? null}
      refreshing={statusQuery.isFetching}
      onRequestAccess={() => void submitRequest({})}
      onRequestAccessDialogOpenChange={(open) => {
        setDialogOpen(open);
        setDialogError(null);
      }}
      onRequesterEmailChange={(email) => {
        setRequesterEmail(email);
        setDialogError(null);
      }}
      onSubmitGuestAccessRequest={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const email = requesterEmail.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          setDialogError(t("deckEditor.requestAccessEmailRequired"));
          return;
        }
        void submitRequest({ email });
      }}
      onSignIn={() => {
        window.location.href = signInHref;
      }}
      onRetry={() => {
        void statusQuery.refetch();
        onReload();
      }}
      onBack={() => void navigate("/home")}
    />
  );
}
