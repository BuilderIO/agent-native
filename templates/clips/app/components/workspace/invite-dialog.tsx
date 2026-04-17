import { useState } from "react";
import { IconMailFast, IconUserPlus } from "@tabler/icons-react";
import { useActionMutation } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type InviteRole = "viewer" | "creator-lite" | "creator" | "admin";

interface InviteDialogProps {
  workspaceId: string;
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

export function InviteDialog({ workspaceId, disabled }: InviteDialogProps) {
  const [open, setOpen] = useState(false);
  const [emailsRaw, setEmailsRaw] = useState("");
  const [role, setRole] = useState<InviteRole>("creator");
  const invite = useActionMutation<
    any,
    { workspaceId: string; email: string; role: InviteRole }
  >("invite-member");
  const qc = useQueryClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const emails = parseEmails(emailsRaw);
    if (!emails.length) {
      toast.error("Enter at least one email address.");
      return;
    }

    const invalid = emails.filter((e) => !isValidEmail(e));
    if (invalid.length) {
      toast.error(`Invalid email(s): ${invalid.join(", ")}`);
      return;
    }

    let ok = 0;
    let fail = 0;
    for (const email of emails) {
      try {
        await invite.mutateAsync({ workspaceId, email, role });
        ok += 1;
      } catch (err) {
        fail += 1;
        toast.error(
          `${email}: ${err instanceof Error ? err.message : "Failed"}`,
        );
      }
    }

    if (ok > 0) {
      toast.success(
        `Sent ${ok} invite${ok === 1 ? "" : "s"}${fail ? `, ${fail} failed` : ""}.`,
      );
      qc.invalidateQueries({ queryKey: ["action", "list-workspace-state"] });
    }
    if (fail === 0) {
      setEmailsRaw("");
      setOpen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={disabled} className="bg-[#625DF5] hover:bg-[#5049d9]">
          <IconUserPlus className="size-4 mr-1.5" />
          Invite members
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite members</DialogTitle>
          <DialogDescription>
            Paste one or more emails separated by commas or new lines. Invites
            expire in 7 days.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="emails">Emails</Label>
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
            <Label htmlFor="role">Role</Label>
            <Select
              value={role}
              onValueChange={(v) => setRole(v as InviteRole)}
            >
              <SelectTrigger id="role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="viewer">Viewer — can watch</SelectItem>
                <SelectItem value="creator-lite">
                  Creator (lite) — can record, limited edit
                </SelectItem>
                <SelectItem value="creator">
                  Creator — record, edit, share
                </SelectItem>
                <SelectItem value="admin">Admin — full control</SelectItem>
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
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={invite.isPending}
              className="bg-[#625DF5] hover:bg-[#5049d9]"
            >
              <IconMailFast className="size-4 mr-1.5" />
              {invite.isPending ? "Sending…" : "Send invites"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
