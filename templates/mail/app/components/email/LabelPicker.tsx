import { actionErrorMessage } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { reportWriteFailure } from "@agent-native/core/client/write-failure";
import type { EmailMessage, Label } from "@shared/types";
import { IconPlus, IconTag } from "@tabler/icons-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  LabelEmailPartialFailure,
  MoveEmailPartialFailure,
  useCreateLabel,
  useLabelEmail,
  useMoveEmail,
} from "@/hooks/use-emails";

export type LabelPickerAction = "label" | "move" | "create";

export interface LabelPickerRequest {
  action: LabelPickerAction;
  createOnly?: boolean;
}

export interface LabelChoice {
  id: string;
  name: string;
  isNew: boolean;
}

function labelKey(name: string): string {
  return name.trim().toLowerCase().replace(/_/g, " ");
}

export function LabelPicker({
  request,
  labels,
  onClose,
  onPick,
}: {
  request: LabelPickerRequest | null;
  labels: readonly Label[];
  onClose: () => void;
  onPick: (choice: LabelChoice, action: LabelPickerAction) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const createOnly = request?.action === "create" || !!request?.createOnly;
  const name = query.trim();
  const userLabels = useMemo(
    () => labels.filter((label) => label.type === "user"),
    [labels],
  );
  const existing = name
    ? userLabels.find((label) => labelKey(label.name) === labelKey(name))
    : undefined;
  const shownLabels =
    request?.action === "create"
      ? []
      : createOnly
        ? existing
          ? [existing]
          : []
        : userLabels;
  const message =
    request?.action === "create" && existing
      ? t("mail.labels.alreadyExists", { name: existing.name })
      : !name && !createOnly && userLabels.length === 0
        ? t("mail.labels.empty")
        : null;
  const pick = (choice: LabelChoice) => {
    const action = request?.action ?? "label";
    setQuery("");
    onClose();
    onPick(choice, action);
  };

  return (
    <CommandDialog
      open={request !== null}
      onOpenChange={(open) => {
        if (open) return;
        setQuery("");
        onClose();
      }}
      motion="instant"
      commandProps={{ loop: true }}
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={t(
          createOnly
            ? "mail.labels.newLabelPlaceholder"
            : request?.action === "move"
              ? "mail.labels.moveToPlaceholder"
              : "mail.labels.labelAsPlaceholder",
        )}
      />
      <CommandList>
        {message && <CommandEmpty>{message}</CommandEmpty>}
        {shownLabels.length > 0 && (
          <CommandGroup>
            {shownLabels.map((label) => (
              <CommandItem
                key={label.id}
                value={label.name}
                onSelect={() =>
                  pick({ id: label.id, name: label.name, isNew: false })
                }
              >
                <IconTag className="me-2 size-4 shrink-0 text-muted-foreground" />
                <span data-an-block className="truncate">
                  {label.name}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {name && !existing && (
          <CommandGroup forceMount>
            <CommandItem
              forceMount
              value={`create:${name}`}
              onSelect={() => pick({ id: labelKey(name), name, isNew: true })}
            >
              <IconPlus className="me-2 size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">
                {t("mail.labels.create", { name })}
              </span>
            </CommandItem>
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}

export function useApplyLabel(removeLabel?: string) {
  const t = useT();
  const createLabel = useCreateLabel();
  const labelEmail = useLabelEmail();
  const moveEmail = useMoveEmail();

  return useCallback(
    async (
      action: LabelPickerAction,
      choice: LabelChoice,
      targets: readonly EmailMessage[],
    ): Promise<{ id: string; name: string } | null> => {
      let label = { id: choice.id, name: choice.name };
      if (choice.isNew) {
        const accountEmails = [
          ...new Set(
            targets
              .map((target) => target.accountEmail)
              .filter((email): email is string => !!email),
          ),
        ];
        try {
          const result = await createLabel.mutateAsync({
            name: choice.name,
            ...(accountEmails.length > 0 ? { accountEmails } : {}),
          });
          label = { id: result.label.id, name: result.label.name };
          if (result.status === "partial")
            toast.error(
              result.accounts
                .filter((account) => account.status === "failed")
                .map((account) => `${account.accountEmail}: ${account.error}`)
                .join("; "),
            );
        } catch (error) {
          toast.error(
            actionErrorMessage(error) ?? t("mail.toasts.createLabelFailed"),
          );
          return null;
        }
      }
      if (action === "create" || targets.length === 0) {
        toast(t("mail.toasts.labelCreated", { label: label.name }));
        return label;
      }

      const variables = {
        id: targets.map((target) => target.id).join(","),
        label: label.id,
        accountEmails: targets
          .map((target) => target.accountEmail ?? "")
          .join(","),
        threadIds: targets
          .map((target) => target.threadId || target.id)
          .join(","),
      };
      if (action === "label") {
        try {
          const result = await labelEmail.mutateAsync(variables);
          toast(
            targets.length > 1
              ? t("mail.toasts.labelManySucceeded", {
                  count: result.succeeded.length,
                  label: label.name,
                })
              : t("mail.toasts.labelSucceeded", { label: label.name }),
          );
          return label;
        } catch (error) {
          if (error instanceof LabelEmailPartialFailure) {
            reportWriteFailure(error, {
              label: t("mail.toasts.labelPartialFailed", {
                succeeded: error.result.succeeded.length,
                total: error.result.requested.length,
                failed: error.result.failed.length,
              }),
            });
          } else {
            toast.error(
              actionErrorMessage(error) ?? t("mail.toasts.labelFailed"),
            );
          }
          return null;
        }
      }

      try {
        const result = await moveEmail.mutateAsync({
          ...variables,
          ...(removeLabel ? { removeLabel } : {}),
        });
        toast(
          targets.length > 1
            ? t("mail.toasts.moveManySucceeded", {
                count: result.succeeded.length,
                label: label.name,
              })
            : t("mail.toasts.moveSucceeded", { label: label.name }),
        );
        return label;
      } catch (error) {
        if (error instanceof MoveEmailPartialFailure) {
          reportWriteFailure(error, {
            label: t("mail.toasts.movePartialFailed", {
              succeeded: error.result.succeeded.length,
              total: error.result.requested.length,
              failed: error.result.failed.length,
            }),
          });
        } else {
          toast.error(actionErrorMessage(error) ?? t("mail.toasts.moveFailed"));
        }
        return null;
      }
    },
    [createLabel, labelEmail, moveEmail, removeLabel, t],
  );
}
