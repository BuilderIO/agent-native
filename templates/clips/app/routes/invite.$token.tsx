import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { IconCheck, IconMailFast, IconX } from "@tabler/icons-react";
import { useSession } from "@agent-native/core/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function meta() {
  return [{ title: "Join workspace · Clips" }];
}

interface InvitePayload {
  id: string;
  workspaceId: string;
  workspaceName: string;
  workspaceBrandColor: string;
  email: string;
  role: string;
  invitedBy: string;
  expiresAt: string | null;
  acceptedAt: string | null;
}

export default function InviteAcceptRoute() {
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
        setError("Missing invite token.");
        setLoading(false);
        return;
      }
      try {
        const res = await fetch(
          `/_agent-native/actions/get-invite?token=${encodeURIComponent(token)}`,
        );
        if (!res.ok) throw new Error(`Invite not found (${res.status})`);
        const json = await res.json();
        if (cancelled) return;
        if (!json.invite) {
          setError(json.error ?? "Invite not found or expired.");
        } else {
          setInvite(json.invite as InvitePayload);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load invite",
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
      const res = await fetch("/_agent-native/actions/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Accept failed (${res.status})`);
      }
      toast.success(`Joined ${invite?.workspaceName ?? "the workspace"}`);
      navigate("/library", { replace: true });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to accept invite",
      );
    } finally {
      setAccepting(false);
    }
  }

  async function handleDecline() {
    if (!token) return;
    try {
      await fetch("/_agent-native/actions/decline-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      toast.success("Invite declined");
      navigate("/", { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to decline");
    } finally {
      setDeclineOpen(false);
    }
  }

  if (!session?.email) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-[#625DF5]/5 to-background">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Sign in required</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              You need to sign in before you can accept a workspace invite.
            </p>
            <Button
              onClick={() =>
                navigate(
                  `/login?next=${encodeURIComponent(`/invite/${token}`)}`,
                )
              }
              className="bg-[#625DF5] hover:bg-[#5049d9]"
            >
              Sign in
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-[#625DF5]/5 to-background">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <IconMailFast className="size-5 text-[#625DF5]" />
            Workspace invite
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : error ? (
            <div className="py-4 text-sm text-red-600">{error}</div>
          ) : invite ? (
            <div className="space-y-4">
              <div
                className="rounded-md p-4 text-white flex items-center gap-3"
                style={{ background: invite.workspaceBrandColor }}
              >
                <div
                  className="h-10 w-10 rounded bg-white/90 flex items-center justify-center font-semibold"
                  style={{ color: invite.workspaceBrandColor }}
                >
                  {invite.workspaceName.slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <div className="font-medium">{invite.workspaceName}</div>
                  <div className="text-xs opacity-90">
                    Role:{" "}
                    <span className="capitalize">
                      {invite.role.replace("-", " ")}
                    </span>
                  </div>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                <strong className="text-foreground">{invite.invitedBy}</strong>{" "}
                invited you to join{" "}
                <strong className="text-foreground">
                  {invite.workspaceName}
                </strong>{" "}
                on Clips.
              </p>
              {invite.email !== session.email ? (
                <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
                  Heads up: this invite was sent to{" "}
                  <strong>{invite.email}</strong>. You're signed in as{" "}
                  <strong>{session.email}</strong>. Accepting will still work
                  but your account email will be the one joining.
                </div>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setDeclineOpen(true)}
                  disabled={accepting}
                >
                  <IconX className="size-4 mr-1.5" />
                  Decline
                </Button>
                <Button
                  onClick={handleAccept}
                  disabled={accepting}
                  className="bg-[#625DF5] hover:bg-[#5049d9]"
                >
                  <IconCheck className="size-4 mr-1.5" />
                  {accepting ? "Joining…" : "Accept invite"}
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <AlertDialog open={declineOpen} onOpenChange={setDeclineOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Decline this invite?</AlertDialogTitle>
            <AlertDialogDescription>
              The invite will be removed. The admin can always send you a new
              one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDecline}>
              Decline
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
