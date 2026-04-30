import { useState } from "react";
import { IconCrown, IconUserX } from "@tabler/icons-react";
import { useActionMutation } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

export type MemberRole = "owner" | "admin" | "member";

export interface MemberRow {
  id: string;
  email: string;
  role: MemberRole;
  joinedAt: string | null;
  invitedAt: string | null;
}

interface MembersListProps {
  organizationId: string;
  members: MemberRow[];
  currentUserEmail: string;
  currentUserRole: MemberRole | "owner";
  disabled?: boolean;
}

function initials(email: string): string {
  const [name] = email.split("@");
  return (name || email).slice(0, 2).toUpperCase();
}

const ROLE_OPTIONS: { value: MemberRole; label: string }[] = [
  { value: "member", label: "Member" },
  { value: "admin", label: "Admin" },
];

export function MembersList({
  organizationId,
  members,
  currentUserEmail,
  currentUserRole,
  disabled,
}: MembersListProps) {
  const isAdmin = !disabled && currentUserRole === "admin";
  const [pendingRemove, setPendingRemove] = useState<MemberRow | null>(null);
  const qc = useQueryClient();

  const updateRole = useActionMutation<
    any,
    { organizationId: string; email: string; role: MemberRole }
  >("update-member-role");
  const removeMember = useActionMutation<
    any,
    { organizationId: string; email: string }
  >("remove-member");

  async function handleRoleChange(member: MemberRow, role: MemberRole) {
    try {
      await updateRole.mutateAsync({
        organizationId,
        email: member.email,
        role,
      });
      toast.success(`Updated ${member.email}'s role to ${role}`);
      qc.invalidateQueries({
        queryKey: ["action", "list-organization-state"],
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update role");
    }
  }

  async function handleRemove() {
    if (!pendingRemove) return;
    try {
      await removeMember.mutateAsync({
        organizationId,
        email: pendingRemove.email,
      });
      toast.success(`Removed ${pendingRemove.email} from the organization`);
      qc.invalidateQueries({
        queryKey: ["action", "list-organization-state"],
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to remove member",
      );
    } finally {
      setPendingRemove(null);
    }
  }

  if (!members.length) {
    return (
      <div className="py-6 text-center text-sm text-muted-foreground">
        No members yet.
      </div>
    );
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead className="w-40">Role</TableHead>
              <TableHead className="w-32">Joined</TableHead>
              {isAdmin ? <TableHead className="w-20"></TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => {
              const isSelf = m.email === currentUserEmail;
              return (
                <TableRow key={m.id}>
                  <TableCell>
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar className="h-8 w-8 flex-shrink-0">
                        <AvatarFallback className="text-xs bg-primary text-primary-foreground">
                          {initials(m.email)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="truncate font-medium flex items-center gap-1.5">
                          {m.email}
                          {m.role === "admin" ? (
                            <IconCrown className="size-3.5 text-amber-500" />
                          ) : null}
                          {isSelf ? (
                            <span className="text-xs text-muted-foreground">
                              (you)
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {isAdmin && !isSelf ? (
                      <Select
                        value={m.role}
                        onValueChange={(v) =>
                          handleRoleChange(m, v as MemberRole)
                        }
                      >
                        <SelectTrigger className="h-8 w-36">
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
                  <TableCell className="text-muted-foreground text-sm">
                    {m.joinedAt
                      ? new Date(m.joinedAt).toLocaleDateString()
                      : "—"}
                  </TableCell>
                  {isAdmin ? (
                    <TableCell>
                      {!isSelf ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-red-600"
                          onClick={() => setPendingRemove(m)}
                          aria-label={`Remove ${m.email}`}
                        >
                          <IconUserX className="size-4" />
                        </Button>
                      ) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={!!pendingRemove}
        onOpenChange={(open) => !open && setPendingRemove(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRemove
                ? `${pendingRemove.email} will lose access to this organization. You can always invite them back.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemove}
              className="bg-red-600 hover:bg-red-700"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
