import { useActionMutation, useT } from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@agent-native/toolkit/ui/dialog";
import { Label } from "@agent-native/toolkit/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { Textarea } from "@agent-native/toolkit/ui/textarea";
import { IconMailFast, IconUserPlus } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

export type InviteRole = "member" | "admin";

interface InviteDialogProps {
  organizationId: string;
  disabled?: boolean;
}

function parseEmails(raw: string): string[] {
  return raw
    .split(/[\s,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isValidEmail(s: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
}

export function InviteDialog({ organizationId, disabled }: InviteDialogProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [emailsRaw, setEmailsRaw] = useState("");
  const [role, setRole] = useState<InviteRole>("member");
  const invite = useActionMutation<
    any,
    { organizationId: string; email: string; role: InviteRole }
  >("invite-member");
  const qc = useQueryClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const emails = parseEmails(emailsRaw);
    if (!emails.length) {
      toast.error(t("inviteDialog.enterEmail"));
      return;
    }

    const invalid = emails.filter((e) => !isValidEmail(e));
    if (invalid.length) {
      toast.error(
        t("inviteDialog.invalidEmails", { emails: invalid.join(", ") }),
      );
      return;
    }

    let ok = 0;
    let fail = 0;
    for (const email of emails) {
      try {
        await invite.mutateAsync({ organizationId, email, role });
        ok += 1;
      } catch (err) {
        fail += 1;
        toast.error(
          t("inviteDialog.emailFailed", {
            email,
            message:
              err instanceof Error ? err.message : t("inviteDialog.failed"),
          }),
        );
      }
    }

    if (ok > 0) {
      toast.success(
        fail
          ? t("inviteDialog.sentWithFailures", { sent: ok, failed: fail })
          : t("inviteDialog.sent", { count: ok }),
      );
      qc.invalidateQueries({
        queryKey: ["action", "list-organization-state"],
      });
    }
    if (fail === 0) {
      setEmailsRaw("");
      setOpen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          disabled={disabled}
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          <IconUserPlus className="size-4 me-1.5" />
          {t("inviteDialog.title")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("inviteDialog.title")}</DialogTitle>
          <DialogDescription>{t("inviteDialog.description")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="emails">{t("inviteDialog.emails")}</Label>
            <Textarea
              id="emails"
              value={emailsRaw}
              onChange={(e) => setEmailsRaw(e.target.value)}
              placeholder={
                "alice@example.com, bob@example.com\ncharlie@example.com"
              }
              rows={4}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="role">{t("organizationSettings.role")}</Label>
            <Select
              value={role}
              onValueChange={(v) => setRole(v as InviteRole)}
            >
              <SelectTrigger id="role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">
                  {t("inviteDialog.memberRole")}
                </SelectItem>
                <SelectItem value="admin">
                  {t("inviteDialog.adminRole")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={invite.isPending}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={invite.isPending}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              <IconMailFast className="size-4 me-1.5" />
              {invite.isPending
                ? t("inviteDialog.sending")
                : t("inviteDialog.sendInvites")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
