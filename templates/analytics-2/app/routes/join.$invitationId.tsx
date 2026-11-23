import { useT } from "@agent-native/core/client/i18n";
import { useAcceptInvitation, useOrg } from "@agent-native/core/client/org";
import { Button } from "@agent-native/toolkit/ui/button";
import { Link, useNavigate, useParams } from "react-router";
export default function JoinWorkspaceRoute() {
  const t = useT();
  const navigate = useNavigate();
  const { invitationId } = useParams<{ invitationId: string }>();
  const org = useOrg();
  const accept = useAcceptInvitation();
  const invitation = org.data?.pendingInvitations?.find(
    (row) => row.id === invitationId,
  );
  const notFound = !org.isLoading && !!org.data && !invitation;
  const loadFailed = org.isError && !org.data;

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-6 py-16">
      <h1 className="text-xl font-semibold text-foreground">
        {t("analytics.settings.inviteLink.joinTitle")}
      </h1>
      {invitation ? (
        <p className="text-sm text-muted-foreground">
          {t("analytics.settings.inviteLink.joinDescription", {
            orgName: invitation.orgName,
            inviter: invitation.invitedBy,
          })}
        </p>
      ) : null}
      {notFound ? (
        <p className="text-sm text-destructive" role="alert">
          {t("analytics.settings.inviteLink.joinNotFound", {
            email: org.data?.email ?? "",
          })}
        </p>
      ) : null}
      {loadFailed ? (
        <div className="flex flex-col items-start gap-2" role="alert">
          <p className="text-sm text-destructive">
            {t("analytics.settings.inviteLink.joinLoadFailed")}
          </p>
          <Button
            onClick={() => void org.refetch()}
            size="sm"
            type="button"
            variant="outline"
          >
            {t("analytics.settings.inviteLink.joinRetry")}
          </Button>
        </div>
      ) : null}
      {accept.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {accept.error instanceof Error && accept.error.message
            ? accept.error.message
            : t("analytics.settings.inviteLink.joinFailed")}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Button
          disabled={!invitationId || !invitation || accept.isPending}
          onClick={() => {
            if (!invitationId) return;
            accept.mutate(invitationId, {
              onSuccess: () => navigate("/", { replace: true }),
            });
          }}
          type="button"
        >
          {accept.isPending
            ? t("analytics.settings.inviteLink.joining")
            : t("analytics.settings.inviteLink.join")}
        </Button>
        <Button asChild type="button" variant="ghost">
          <Link to="/">{t("analytics.settings.inviteLink.back")}</Link>
        </Button>
      </div>
    </main>
  );
}
