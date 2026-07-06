import { useActionMutation, useT } from "@agent-native/core/client";
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
import { Avatar, AvatarFallback } from "@agent-native/toolkit/ui/avatar";
import { Badge } from "@agent-native/toolkit/ui/badge";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@agent-native/toolkit/ui/table";
import { IconCrown, IconUserX } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

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

const ROLE_OPTIONS: { value: MemberRole; labelKey: string }[] = [
  { value: "member", labelKey: "membersList.memberRole" },
  { value: "admin", labelKey: "membersList.adminRole" },
];

export function MembersList({
  organizationId,
  members,
  currentUserEmail,
  currentUserRole,
  disabled,
}: MembersListProps) {
  const t = useT();
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
      toast.success(
        t("membersList.roleUpdated", { email: member.email, role }),
      );
      qc.invalidateQueries({
        queryKey: ["action", "list-organization-state"],
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("membersList.updateFailed"),
      );
    }
  }

  async function handleRemove() {
    if (!pendingRemove) return;
    try {
      await removeMember.mutateAsync({
        organizationId,
        email: pendingRemove.email,
      });
      toast.success(t("membersList.removed", { email: pendingRemove.email }));
      qc.invalidateQueries({
        queryKey: ["action", "list-organization-state"],
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("membersList.removeFailed"),
      );
    } finally {
      setPendingRemove(null);
    }
  }

  if (!members.length) {
    return (
      <div className="py-6 text-center text-sm text-muted-foreground">
        {t("membersList.noMembers")}
      </div>
    );
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("membersList.member")}</TableHead>
              <TableHead className="w-40">
                {t("organizationSettings.role")}
              </TableHead>
              <TableHead className="w-32">{t("membersList.joined")}</TableHead>
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
                              {t("membersList.you")}
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
                              {t(opt.labelKey)}
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
                          aria-label={t("membersList.removeMemberLabel", {
                            email: m.email,
                          })}
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
            <AlertDialogTitle>{t("membersList.removeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRemove
                ? t("membersList.removeDescription", {
                    email: pendingRemove.email,
                  })
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemove}
              className="bg-red-600 hover:bg-red-700"
            >
              {t("membersList.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
