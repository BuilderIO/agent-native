import { useMemo, useState } from "react";
import {
  useActionQuery,
  useActionMutation,
  useSession,
} from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";
import {
  IconSend,
  IconUserX,
  IconCrown,
  IconMailForward,
  IconTrash,
} from "@tabler/icons-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

type MemberRole = "viewer" | "creator-lite" | "creator" | "admin";

interface Member {
  id: string;
  email: string;
  role: MemberRole;
  joinedAt: string | null;
  invitedAt: string | null;
  isCurrentUser?: boolean;
}

interface PendingInvite {
  id: string;
  email: string;
  role: MemberRole;
  createdAt: string;
  invitedBy: string | null;
}

const ROLE_OPTIONS: { value: MemberRole; label: string; help: string }[] = [
  {
    value: "viewer",
    label: "Viewer",
    help: "Can watch calls shared with them",
  },
  {
    value: "creator-lite",
    label: "Creator (lite)",
    help: "Can upload and share their own calls",
  },
  { value: "creator", label: "Creator", help: "Full library + sharing access" },
  {
    value: "admin",
    label: "Admin",
    help: "Manage members, billing, and workspace settings",
  },
];

function initials(email: string): string {
  const [local] = email.split("@");
  return (local || email).slice(0, 2).toUpperCase();
}

interface MembersPanelProps {
  workspaceId: string;
}

export function MembersPanel({ workspaceId }: MembersPanelProps) {
  const qc = useQueryClient();
  const { session } = useSession();
  const currentEmail = session?.email ?? "";

  const { data, isLoading } = useActionQuery<{
    members: Member[];
    pendingInvites?: PendingInvite[];
    currentRole?: MemberRole | "owner";
  }>("list-workspace-state", undefined, {});
  const members = data?.members ?? [];
  const pending = data?.pendingInvites ?? [];
  const canManage =
    (data?.currentRole ?? "viewer") === "admin" ||
    data?.currentRole === "owner";

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<MemberRole>("creator");
  const [pendingRemove, setPendingRemove] = useState<Member | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<PendingInvite | null>(
    null,
  );

  const invite = useActionMutation<any, { email: string; role: MemberRole }>(
    "invite-member",
  );
  const resend = useActionMutation<any, { id: string }>("resend-invite");
  const revoke = useActionMutation<any, { id: string }>("revoke-invite");
  const updateRole = useActionMutation<
    any,
    { email: string; role: MemberRole }
  >("update-member-role");
  const remove = useActionMutation<any, { email: string }>("remove-member");

  const sortedMembers = useMemo(
    () =>
      [...members].sort((a, b) => {
        if (a.email === currentEmail) return -1;
        if (b.email === currentEmail) return 1;
        return a.email.localeCompare(b.email);
      }),
    [members, currentEmail],
  );

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    const email = inviteEmail.trim();
    if (!email) return;
    try {
      await invite.mutateAsync({ email, role: inviteRole });
      qc.invalidateQueries({ queryKey: ["action", "list-workspace-state"] });
      toast.success(`Invite sent to ${email}`);
      setInviteEmail("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invite failed");
    }
  }

  async function handleResend(p: PendingInvite) {
    try {
      await resend.mutateAsync({ id: p.id });
      toast.success(`Invite resent to ${p.email}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Resend failed");
    }
  }

  async function handleRevoke() {
    if (!pendingRevoke) return;
    try {
      await revoke.mutateAsync({ id: pendingRevoke.id });
      qc.invalidateQueries({ queryKey: ["action", "list-workspace-state"] });
      toast.success("Invite revoked");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Revoke failed");
    } finally {
      setPendingRevoke(null);
    }
  }

  async function handleRoleChange(m: Member, role: MemberRole) {
    try {
      await updateRole.mutateAsync({ email: m.email, role });
      qc.invalidateQueries({ queryKey: ["action", "list-workspace-state"] });
      toast.success(`${m.email} is now a ${role.replace("-", " ")}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Role change failed");
    }
  }

  async function handleRemove() {
    if (!pendingRemove) return;
    try {
      await remove.mutateAsync({ email: pendingRemove.email });
      qc.invalidateQueries({ queryKey: ["action", "list-workspace-state"] });
      toast.success(`Removed ${pendingRemove.email}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setPendingRemove(null);
    }
  }

  return (
    <div className="space-y-6">
      {canManage && (
        <form
          onSubmit={handleInvite}
          className="flex flex-wrap items-end gap-2"
        >
          <div className="flex-1 min-w-[14rem]">
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Invite by email
            </label>
            <Input
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="teammate@company.com"
              type="email"
              required
            />
          </div>
          <div className="w-44">
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Role
            </label>
            <Select
              value={inviteRole}
              onValueChange={(v) => setInviteRole(v as MemberRole)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={invite.isPending} className="gap-1.5">
            <IconSend className="h-4 w-4" />
            {invite.isPending ? "Sending…" : "Send invite"}
          </Button>
        </form>
      )}

      <section>
        <h3 className="text-sm font-semibold text-foreground mb-2">Members</h3>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : sortedMembers.length === 0 ? (
          <div className="rounded-md border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
            You're the only one here — invite a teammate above to collaborate.
          </div>
        ) : (
          <div className="rounded-md border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead className="w-44">Role</TableHead>
                  <TableHead className="w-40">Joined</TableHead>
                  {canManage && <TableHead className="w-14" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedMembers.map((m) => {
                  const isSelf = m.email === currentEmail;
                  return (
                    <TableRow key={m.id}>
                      <TableCell>
                        <div className="flex items-center gap-2 min-w-0">
                          <Avatar className="h-8 w-8 shrink-0">
                            <AvatarFallback className="text-xs bg-foreground text-background">
                              {initials(m.email)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 truncate text-sm font-medium">
                              <span className="truncate">{m.email}</span>
                              {m.role === "admin" && (
                                <IconCrown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              )}
                              {isSelf && (
                                <span className="text-xs text-muted-foreground">
                                  (you)
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {canManage && !isSelf ? (
                          <Select
                            value={m.role}
                            onValueChange={(v) =>
                              handleRoleChange(m, v as MemberRole)
                            }
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ROLE_OPTIONS.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge variant="outline" className="capitalize">
                            {m.role.replace("-", " ")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {m.joinedAt
                          ? new Date(m.joinedAt).toLocaleDateString()
                          : "—"}
                      </TableCell>
                      {canManage && (
                        <TableCell>
                          {!isSelf && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => setPendingRemove(m)}
                              aria-label={`Remove ${m.email}`}
                            >
                              <IconUserX className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {pending.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-foreground mb-2">
            Pending invites
          </h3>
          <div className="rounded-md border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead className="w-40">Role</TableHead>
                  <TableHead className="w-40">Invited</TableHead>
                  {canManage && <TableHead className="w-32" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-sm">{p.email}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {p.role.replace("-", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(p.createdAt).toLocaleDateString()}
                    </TableCell>
                    {canManage && (
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground"
                            onClick={() => handleResend(p)}
                            aria-label="Resend invite"
                          >
                            <IconMailForward className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => setPendingRevoke(p)}
                            aria-label="Revoke invite"
                          >
                            <IconTrash className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      <AlertDialog
        open={!!pendingRemove}
        onOpenChange={(o) => !o && setPendingRemove(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRemove?.email} will lose access to this workspace. You can
              invite them back later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!pendingRevoke}
        onOpenChange={(o) => !o && setPendingRevoke(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke invite?</AlertDialogTitle>
            <AlertDialogDescription>
              The invite link for {pendingRevoke?.email} will stop working.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevoke}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
