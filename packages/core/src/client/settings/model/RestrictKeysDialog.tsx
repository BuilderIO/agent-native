import { Alert, AlertDescription } from "@agent-native/toolkit/ui/alert";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@agent-native/toolkit/ui/alert-dialog";
import { Button } from "@agent-native/toolkit/ui/button";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import { IconAlertCircle, IconLock, IconUser } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import type { PersonalProviderKeyHolder } from "../../../server/personal-provider-key-holders.js";
import { useFormatters, useT } from "../../i18n.js";

const K = "agentChat.settingsModel.";

export interface RestrictKeysDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Members whose personal keys stop; undefined while loading. */
  affectedMembers: readonly PersonalProviderKeyHolder[] | undefined;
  /** Rejects with the server's message; the dialog stays open to show it. */
  onConfirm: () => Promise<void>;
}

/** "Restrict personal API keys?" listing each member and what stops for them. */
export function RestrictKeysDialog({
  open,
  onOpenChange,
  affectedMembers,
  onConfirm,
}: RestrictKeysDialogProps) {
  const t = useT();
  const formatters = useFormatters();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const confirm = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(`${K}restrictTitle`)}</AlertDialogTitle>
          <AlertDialogDescription>
            {t(`${K}restrictBody`)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-2 text-sm">
          <p className="font-medium">{t(`${K}whatHappens`)}</p>
          <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/70">
            {affectedMembers === undefined ? (
              <li
                className="grid gap-2 px-4 py-3"
                aria-busy="true"
                aria-label={t("agentChat.settingsShell.loading")}
              >
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-3/4" />
              </li>
            ) : (
              affectedMembers.map((member) => {
                const labels = member.providers.map((item) => item.label);
                const lines = [
                  labels.length > 0
                    ? t(`${K}restrictMemberKeys`, {
                        count: labels.length,
                        providers: formatters.formatList(labels, {
                          style: "long",
                          type: "conjunction",
                        }),
                      })
                    : null,
                  member.builder ? t(`${K}restrictMemberBuilder`) : null,
                  t(`${K}restrictMemberChats`),
                ].filter(Boolean);
                return (
                  <li key={member.email} className="flex gap-3 px-4 py-3">
                    <IconUser
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <div className="grid gap-0.5">
                      <span className="font-medium">{member.email}</span>
                      <span className="text-muted-foreground">
                        {lines.join(" ")}
                      </span>
                    </div>
                  </li>
                );
              })
            )}
            <li className="flex gap-3 px-4 py-3">
              <IconLock
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <div className="grid gap-0.5">
                <span className="font-medium">
                  {t(`${K}restrictNewKeysTitle`)}
                </span>
                <span className="text-muted-foreground">
                  {t(`${K}restrictNewKeysBody`)}
                </span>
              </div>
            </li>
          </ul>
        </div>
        {error ? (
          <Alert variant="destructive">
            <IconAlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
          >
            {t(`${K}cancel`)}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending || affectedMembers === undefined}
            onClick={() => void confirm()}
          >
            {pending ? <Spinner /> : null}
            {pending ? t(`${K}restricting`) : t(`${K}restrictConfirm`)}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
