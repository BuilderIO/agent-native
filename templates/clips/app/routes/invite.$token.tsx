import { callAction, useSession, useT } from "@agent-native/core/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@agent-native/toolkit/ui/alert-dialog";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@agent-native/toolkit/ui/card";
import { IconCheck, IconMailFast, IconX } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";

import enMessages from "@/i18n/en-US";

export function meta() {
  return [{ title: enMessages.inviteRoute.pageTitle }];
}

interface InvitePayload {
  id: string;
  organizationId: string;
  organizationName: string;
  organizationBrandColor: string;
  email: string;
  role: string;
  invitedBy: string;
  expiresAt: string | null;
  acceptedAt: string | null;
}

export default function InviteAcceptRoute() {
  const t = useT();
  const { token } = useParams<{ token: string }>();
  const { session } = useSession();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<InvitePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!token) {
        setError(t("inviteRoute.missingToken"));
        setLoading(false);
        return;
      }
      try {
        const json = await callAction<{
          invite: InvitePayload | null;
          error?: string;
        }>("get-invite" as any, { token } as any, { method: "GET" });
        if (cancelled) return;
        if (!json.invite) {
          setError(json.error ?? t("inviteRoute.notFound"));
        } else {
          setInvite(json.invite as InvitePayload);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : t("inviteRoute.loadFailed"),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleAccept() {
    if (!token) return;
    setAccepting(true);
    try {
      await callAction("accept-invite" as any, { token } as any);
      toast.success(
        t("inviteRoute.joined", {
          team: invite?.organizationName ?? t("inviteRoute.theTeam"),
        }),
      );
      navigate("/library", { replace: true });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("inviteRoute.acceptFailed"),
      );
    } finally {
      setAccepting(false);
    }
  }

  async function handleDecline() {
    if (!token) return;
    try {
      await callAction("decline-invite" as any, { token } as any);
      toast.success(t("inviteRoute.declined"));
      navigate("/", { replace: true });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("inviteRoute.declineFailed"),
      );
    } finally {
      setDeclineOpen(false);
    }
  }

  if (!session?.email) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-primary/5 to-background">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>{t("inviteRoute.signInRequired")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              {t("inviteRoute.signInDescription")}
            </p>
            <Button
              onClick={() =>
                navigate(
                  `/login?next=${encodeURIComponent(`/invite/${token}`)}`,
                )
              }
              className="bg-primary hover:bg-primary/90"
            >
              {t("inviteRoute.signIn")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-primary/5 to-background">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <IconMailFast className="size-5 text-primary" />
            {t("inviteRoute.invited")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {t("inviteRoute.loading")}
            </div>
          ) : error ? (
            <div className="py-4 text-sm text-red-600">{error}</div>
          ) : invite ? (
            <div className="space-y-4">
              <div
                className="rounded-md p-4 text-white flex items-center gap-3"
                style={{ background: invite.organizationBrandColor }}
              >
                <div
                  className="h-10 w-10 rounded bg-white/90 flex items-center justify-center font-semibold"
                  style={{ color: invite.organizationBrandColor }}
                >
                  {invite.organizationName.slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <div className="font-medium">{invite.organizationName}</div>
                  <div className="text-xs opacity-90">
                    {t("inviteRoute.role")}{" "}
                    <span className="capitalize">
                      {invite.role.replace("-", " ")}
                    </span>
                  </div>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                {t("inviteRoute.invitedToJoin", {
                  inviter: invite.invitedBy,
                  team: invite.organizationName,
                })}
              </p>
              {invite.email !== session.email ? (
                <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
                  {t("inviteRoute.emailMismatch", {
                    inviteEmail: invite.email,
                    sessionEmail: session.email,
                  })}
                </div>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setDeclineOpen(true)}
                  disabled={accepting}
                >
                  <IconX className="size-4 me-1.5" />
                  {t("inviteRoute.decline")}
                </Button>
                <Button
                  onClick={handleAccept}
                  disabled={accepting}
                  className="bg-primary hover:bg-primary/90"
                >
                  <IconCheck className="size-4 me-1.5" />
                  {accepting
                    ? t("inviteRoute.joining")
                    : t("inviteRoute.acceptInvite")}
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <AlertDialog open={declineOpen} onOpenChange={setDeclineOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("inviteRoute.declineInvite")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("inviteRoute.declineDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("inviteRoute.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDecline}>
              {t("inviteRoute.decline")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
