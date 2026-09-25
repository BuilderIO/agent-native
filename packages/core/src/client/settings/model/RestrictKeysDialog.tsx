import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@agent-native/toolkit/ui/alert-dialog";
import { Button } from "@agent-native/toolkit/ui/button";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { IconLock, IconUser } from "@tabler/icons-react";

import type { PersonalProviderKeyHolder } from "../../../server/personal-provider-key-holders.js";
import { useFormatters, useT } from "../../i18n.js";

const K = "agentChat.settingsModel.";

export interface RestrictKeysDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Members whose personal keys stop; undefined while loading. */
  affectedMembers: readonly PersonalProviderKeyHolder[] | undefined;
  onConfirm: () => void;
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
        <AlertDialogFooter>
          <AlertDialogCancel>{t(`${K}cancel`)}</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {t(`${K}restrictConfirm`)}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
