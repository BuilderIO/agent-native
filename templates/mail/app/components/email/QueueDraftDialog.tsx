import { useT } from "@agent-native/core/client/i18n";
import { IconLoader2, IconPlus } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useQueueEmailDraft } from "@/hooks/use-draft-queue";

export type DraftFormState = {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  context: string;
};

export const EMPTY_FORM: DraftFormState = {
  to: "",
  cc: "",
  bcc: "",
  subject: "",
  body: "",
  context: "",
};

export function QueueDraftDialog({
  open,
  onOpenChange,
  members,
  currentUser,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: { email: string; role: string }[];
  currentUser: string;
}) {
  const t = useT();
  const queueDraft = useQueueEmailDraft();
  const [ownerEmail, setOwnerEmail] = useState(currentUser);
  const [form, setForm] = useState<DraftFormState>(EMPTY_FORM);

  useEffect(() => {
    if (open) setOwnerEmail(currentUser || members[0]?.email || "");
  }, [currentUser, members, open]);

  const update = (patch: Partial<DraftFormState>) =>
    setForm((current) => ({ ...current, ...patch }));

  const canSubmit = ownerEmail && form.to.trim() && form.body.trim();

  const submit = () => {
    if (!canSubmit) return;
    queueDraft.mutate(
      {
        ownerEmail,
        to: form.to,
        cc: form.cc || undefined,
        bcc: form.bcc || undefined,
        subject: form.subject || t("mail.draftQueue.noSubject"),
        body: form.body,
        context: form.context || undefined,
        source: "ui",
      },
      {
        onSuccess: () => {
          toast(t("mail.toasts.draftQueued"));
          setForm(EMPTY_FORM);
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("mail.draftQueue.queueDraft")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase text-muted-foreground">
                {t("mail.draftQueue.reviewer")}
              </label>
              <Select value={ownerEmail} onValueChange={setOwnerEmail}>
                <SelectTrigger data-an-block>
                  <SelectValue
                    placeholder={t("mail.draftQueue.chooseMember")}
                  />
                </SelectTrigger>
                <SelectContent data-an-block>
                  {members.map((member) => (
                    <SelectItem key={member.email} value={member.email}>
                      {member.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase text-muted-foreground">
                {t("mail.draftQueue.to")}
              </label>
              <Input
                value={form.to}
                onChange={(event) => update({ to: event.target.value })}
                placeholder="recipient@example.com"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase text-muted-foreground">
                {t("mail.draftQueue.cc")}
              </label>
              <Input
                value={form.cc}
                onChange={(event) => update({ cc: event.target.value })}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase text-muted-foreground">
                {t("mail.draftQueue.bcc")}
              </label>
              <Input
                value={form.bcc}
                onChange={(event) => update({ bcc: event.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase text-muted-foreground">
              {t("mail.draftQueue.subject")}
            </label>
            <Input
              value={form.subject}
              onChange={(event) => update({ subject: event.target.value })}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase text-muted-foreground">
              {t("mail.draftQueue.draft")}
            </label>
            <Textarea
              value={form.body}
              onChange={(event) => update({ body: event.target.value })}
              rows={8}
              className="resize-none"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase text-muted-foreground">
              {t("mail.draftQueue.context")}
            </label>
            <Textarea
              value={form.context}
              onChange={(event) => update({ context: event.target.value })}
              rows={3}
              className="resize-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t("mail.draftQueue.cancel")}
            </Button>
            <Button
              onClick={submit}
              disabled={!canSubmit || queueDraft.isPending}
            >
              {queueDraft.isPending ? (
                <IconLoader2 className="h-4 w-4 animate-spin" />
              ) : (
                <IconPlus className="h-4 w-4" />
              )}
              {t("mail.draftQueue.queueDraft")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
