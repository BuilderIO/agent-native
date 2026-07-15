import {
  IconAdjustmentsHorizontal,
  IconBolt,
  IconLoader2,
  IconUserCheck,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
import { useT } from "../i18n.js";
import { useActionMutation, useActionQuery } from "../use-action.js";
import type {
  FeatureFlagMetadata,
  FeatureFlagRules,
  ListFeatureFlagsResult,
  SetFeatureFlagInput,
} from "./types.js";

export { hasManageableFeatureFlags } from "./helpers.js";

export function useFeatureFlagsSettings() {
  return useActionQuery<ListFeatureFlagsResult>("list-feature-flags" as never);
}

function optimisticRules(
  flag: FeatureFlagMetadata,
  input: SetFeatureFlagInput,
): FeatureFlagRules {
  if (input.operation === "replace-rules" && input.rules) return input.rules;
  if (input.operation === "off") {
    return { version: 1, mode: "off", emails: [], orgIds: [], percentage: 0 };
  }
  return { ...flag.rules, mode: "rules" };
}

function useSetFeatureFlag(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  return useActionMutation<unknown, SetFeatureFlagInput>(
    "set-feature-flag" as never,
    {
      onMutate: async (input) => {
        const queryKey = ["action", "list-feature-flags", undefined];
        await queryClient.cancelQueries({ queryKey });
        const previous =
          queryClient.getQueryData<ListFeatureFlagsResult>(queryKey);
        queryClient.setQueryData<ListFeatureFlagsResult>(queryKey, (current) =>
          current
            ? {
                ...current,
                flags: current.flags.map((flag) =>
                  flag.key === input.key
                    ? { ...flag, rules: optimisticRules(flag, input) }
                    : flag,
                ),
              }
            : current,
        );
        return previous;
      },
      onError: (_error, _input, previous) => {
        queryClient.setQueryData(
          ["action", "list-feature-flags", undefined],
          previous,
        );
      },
      onSettled: () => {
        void queryClient.invalidateQueries({
          queryKey: ["action", "list-feature-flags"],
        });
      },
      onSuccess,
    },
  );
}

function formatActor(actor: FeatureFlagRules["updatedBy"]): string | null {
  if (!actor) return null;
  if (typeof actor === "string") return actor;
  return actor.name ?? actor.email ?? null;
}

function formatWhen(value: number | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function rolloutLabel(
  rules: FeatureFlagRules,
  t: ReturnType<typeof useT>,
): string {
  if (rules.mode === "off") return t("featureFlags.off");
  if (rules.mode === "on") return t("featureFlags.everyone");
  const parts = [
    rules.emails.length
      ? t("featureFlags.emailCount", { count: rules.emails.length })
      : null,
    rules.orgIds.length
      ? t("featureFlags.organizationCount", { count: rules.orgIds.length })
      : null,
    rules.percentage
      ? t("featureFlags.percentageRollout", { count: rules.percentage })
      : null,
  ].filter(Boolean);
  return parts.join(" · ") || t("featureFlags.inherited");
}

function modeLabel(rules: FeatureFlagRules, t: ReturnType<typeof useT>) {
  if (rules.mode === "off") return t("featureFlags.off");
  if (rules.mode === "on") return t("featureFlags.everyone");
  return t("featureFlags.targeted");
}

function listText(values: string[]): string {
  return values.join("\n");
}

function parseList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\n,]/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
}

function TargetingDialog({
  flag,
  open,
  onOpenChange,
}: {
  flag: FeatureFlagMetadata;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const [mode, setMode] = useState(flag.rules.mode);
  const [emails, setEmails] = useState(() => listText(flag.rules.emails));
  const [orgIds, setOrgIds] = useState(() => listText(flag.rules.orgIds));
  const [percentage, setPercentage] = useState(String(flag.rules.percentage));
  const setFlag = useSetFeatureFlag(() => onOpenChange(false));

  const save = () => {
    setFlag.mutate({
      key: flag.key,
      operation: "replace-rules",
      rules: {
        version: 1,
        mode,
        emails: parseList(emails),
        orgIds: parseList(orgIds),
        percentage: Math.max(0, Math.min(100, Number(percentage) || 0)),
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("featureFlags.advanced")}</DialogTitle>
          <DialogDescription>
            {t("featureFlags.targetingDescription", {
              name: flag.displayName ?? flag.key,
            })}
          </DialogDescription>
        </DialogHeader>
        <label className="grid gap-2 text-sm font-medium text-foreground">
          {t("featureFlags.modeLabel")}
          <select
            className="h-10 rounded-md border border-border bg-background px-3 text-sm font-normal text-foreground outline-none focus:ring-1 focus:ring-accent"
            value={mode}
            onChange={(event) =>
              setMode(event.target.value as FeatureFlagRules["mode"])
            }
          >
            <option value="off">{t("featureFlags.off")}</option>
            <option value="rules">{t("featureFlags.targeted")}</option>
            <option value="on">{t("featureFlags.everyone")}</option>
          </select>
        </label>
        {mode === "rules" ? (
          <div className="grid gap-4">
            <label className="grid gap-2 text-sm font-medium text-foreground">
              {t("featureFlags.emailsLabel")}
              <textarea
                className="min-h-20 rounded-md border border-border bg-background px-3 py-2 text-sm font-normal text-foreground outline-none focus:ring-1 focus:ring-accent"
                value={emails}
                onChange={(event) => setEmails(event.target.value)}
                placeholder="one@example.com"
              />
            </label>
            <label className="grid gap-2 text-sm font-medium text-foreground">
              {t("featureFlags.orgIdsLabel")}
              <textarea
                className="min-h-20 rounded-md border border-border bg-background px-3 py-2 text-sm font-normal text-foreground outline-none focus:ring-1 focus:ring-accent"
                value={orgIds}
                onChange={(event) => setOrgIds(event.target.value)}
                placeholder="org_123"
              />
            </label>
            <label className="grid gap-2 text-sm font-medium text-foreground">
              {t("featureFlags.percentageLabel")}
              <input
                className="h-10 rounded-md border border-border bg-background px-3 text-sm font-normal text-foreground outline-none focus:ring-1 focus:ring-accent"
                type="number"
                min="0"
                max="100"
                value={percentage}
                onChange={(event) => setPercentage(event.target.value)}
              />
            </label>
          </div>
        ) : null}
        <DialogFooter>
          <button
            type="button"
            className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
            onClick={() => onOpenChange(false)}
          >
            {t("featureFlags.cancel")}
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent/80 disabled:opacity-50"
            disabled={setFlag.isPending}
            onClick={save}
          >
            {setFlag.isPending ? (
              <IconLoader2 className="size-4 animate-spin" />
            ) : null}
            {t("featureFlags.saveRules")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FeatureFlagRow({ flag }: { flag: FeatureFlagMetadata }) {
  const t = useT();
  const [targetingOpen, setTargetingOpen] = useState(false);
  const setFlag = useSetFeatureFlag();
  const actor = formatActor(flag.rules.updatedBy);
  const when = formatWhen(flag.rules.updatedAt);
  const metadata = [actor, when].filter(Boolean).join(" · ");

  return (
    <article
      id={`feature-flag-${flag.key}`}
      className="grid gap-4 scroll-mt-24 border-b border-border py-5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-sm font-medium text-foreground">
            {flag.displayName ?? flag.key}
          </h3>
          <code className="truncate text-xs text-muted-foreground">
            {flag.key}
          </code>
        </div>
        {flag.description ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {flag.description}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            {t("featureFlags.rollout")}: {rolloutLabel(flag.rules, t)}
          </span>
          <span>
            {flag.defaultValue
              ? t("featureFlags.defaultOn")
              : t("featureFlags.defaultOff")}
          </span>
          <span>
            {t("featureFlags.runtime")}: {modeLabel(flag.rules, t)}
          </span>
          {metadata ? (
            <span>{t("featureFlags.lastChanged", { metadata })}</span>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent/40 disabled:opacity-50"
          disabled={setFlag.isPending}
          onClick={() =>
            setFlag.mutate({
              key: flag.key,
              operation: "enable-for-current-user",
            })
          }
        >
          <IconUserCheck className="size-3.5" />
          {t("featureFlags.enableForMe")}
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
          disabled={setFlag.isPending}
          onClick={() => setFlag.mutate({ key: flag.key, operation: "off" })}
        >
          <IconBolt className="size-3.5" />
          {t("featureFlags.immediateOff")}
        </button>
        <button
          type="button"
          className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
          onClick={() => setTargetingOpen(true)}
          aria-label={t("featureFlags.advancedFor", {
            name: flag.displayName ?? flag.key,
          })}
          title={t("featureFlags.advanced")}
        >
          <IconAdjustmentsHorizontal className="size-4" />
        </button>
      </div>
      <TargetingDialog
        flag={flag}
        open={targetingOpen}
        onOpenChange={setTargetingOpen}
      />
    </article>
  );
}

export function FeatureFlagsPanel({ flags }: { flags: FeatureFlagMetadata[] }) {
  const t = useT();
  const sortedFlags = useMemo(
    () => [...flags].sort((left, right) => left.key.localeCompare(right.key)),
    [flags],
  );

  return (
    <section
      className="mx-auto w-full max-w-2xl"
      aria-labelledby="feature-flags-title"
    >
      <header className="border-b border-border pb-5">
        <h2
          id="feature-flags-title"
          className="text-base font-semibold text-foreground"
        >
          {t("featureFlags.title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("featureFlags.description")}
        </p>
      </header>
      {sortedFlags.length ? (
        <div>
          {sortedFlags.map((flag) => (
            <FeatureFlagRow key={flag.key} flag={flag} />
          ))}
        </div>
      ) : (
        <p className="py-8 text-sm text-muted-foreground">
          {t("featureFlags.noFlags")}
        </p>
      )}
    </section>
  );
}
