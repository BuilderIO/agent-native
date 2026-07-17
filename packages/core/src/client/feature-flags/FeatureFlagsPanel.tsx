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
import { Badge } from "@agent-native/toolkit/ui/badge";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import { Input } from "@agent-native/toolkit/ui/input";
import { Label } from "@agent-native/toolkit/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { Textarea } from "@agent-native/toolkit/ui/textarea";
import {
  IconCheck,
  IconDots,
  IconSettings,
  IconLoader2,
  IconUserCheck,
} from "@tabler/icons-react";
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
import {
  normalizeFeatureFlagPercentage,
  normalizeFeatureFlagRules,
} from "./helpers.js";
import type {
  FeatureFlagMetadata,
  FeatureFlagRules,
  SetFeatureFlagInput,
} from "./types.js";

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

function audienceLabel(
  rules: FeatureFlagRules,
  t: ReturnType<typeof useT>,
): string {
  if (rules.mode === "off") return t("featureFlags.off");
  if (rules.mode === "on") return t("featureFlags.everyoneAudience");
  return rolloutLabel(rules, t);
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
  onMutate,
  isPending,
}: {
  flag: FeatureFlagMetadata;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMutate: (input: SetFeatureFlagInput) => void;
  isPending?: boolean;
}) {
  const t = useT();
  const modeId = `feature-flag-${flag.key}-mode`;
  const emailsId = `feature-flag-${flag.key}-emails`;
  const orgIdsId = `feature-flag-${flag.key}-org-ids`;
  const percentageId = `feature-flag-${flag.key}-percentage`;
  const [mode, setMode] = useState(flag.rules.mode);
  const [emails, setEmails] = useState(() => listText(flag.rules.emails));
  const [orgIds, setOrgIds] = useState(() => listText(flag.rules.orgIds));
  const [percentage, setPercentage] = useState(String(flag.rules.percentage));

  const save = () => {
    const nextPercentage = normalizeFeatureFlagPercentage(percentage);
    onMutate({
      key: flag.key,
      operation: "replace-rules",
      rules: {
        version: 1,
        mode,
        emails: parseList(emails),
        orgIds: parseList(orgIds),
        percentage: nextPercentage,
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {t("featureFlags.targetingTitle", {
              name: flag.displayName ?? flag.key,
            })}
          </DialogTitle>
          <DialogDescription>
            {t("featureFlags.targetingDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor={modeId}>{t("featureFlags.modeLabel")}</Label>
          <Select
            value={mode}
            onValueChange={(value) =>
              setMode(value as FeatureFlagRules["mode"])
            }
          >
            <SelectTrigger id={modeId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="off">{t("featureFlags.off")}</SelectItem>
                <SelectItem value="rules">
                  {t("featureFlags.targeted")}
                </SelectItem>
                <SelectItem value="on">{t("featureFlags.everyone")}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        {mode === "rules" ? (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor={emailsId}>{t("featureFlags.emailsLabel")}</Label>
              <Textarea
                id={emailsId}
                className="min-h-20"
                value={emails}
                onChange={(event) => setEmails(event.target.value)}
                placeholder="one@example.com"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={orgIdsId}>{t("featureFlags.orgIdsLabel")}</Label>
              <Textarea
                id={orgIdsId}
                className="min-h-20"
                value={orgIds}
                onChange={(event) => setOrgIds(event.target.value)}
                placeholder="org_123"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={percentageId}>
                {t("featureFlags.percentageLabel")}
              </Label>
              <Input
                id={percentageId}
                type="number"
                min="0"
                max="100"
                step="1"
                value={percentage}
                onChange={(event) => setPercentage(event.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {t("featureFlags.targetingRuleHelp")}
            </p>
          </div>
        ) : null}
        <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
          {t("featureFlags.targetingSummary", {
            audience: audienceLabel(
              normalizeFeatureFlagRules({
                mode,
                emails: parseList(emails),
                orgIds: parseList(orgIds),
                percentage: normalizeFeatureFlagPercentage(percentage),
              }),
              t,
            ),
          })}
          <span className="ms-2 text-xs text-muted-foreground">
            ·{" "}
            {flag.defaultValue
              ? t("featureFlags.defaultOn")
              : t("featureFlags.defaultOff")}
          </span>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            {t("featureFlags.cancel")}
          </Button>
          <Button type="button" disabled={isPending} onClick={save}>
            {isPending ? <IconLoader2 className="animate-spin" /> : null}
            {t("featureFlags.saveRules")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FeatureFlagRow({
  flag,
  onMutate,
  isPending,
  error,
}: {
  flag: FeatureFlagMetadata;
  onMutate: (input: SetFeatureFlagInput) => void;
  isPending?: boolean;
  error?: Error | null;
}) {
  const t = useT();
  const [targetingOpen, setTargetingOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const actor = formatActor(flag.rules.updatedBy);
  const when = formatWhen(flag.rules.updatedAt);
  const metadata = [actor, when].filter(Boolean).join(" · ");

  return (
    <article
      id={`feature-flag-${flag.key}`}
      className="grid gap-4 scroll-mt-24 border-b border-border py-5 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-sm font-medium text-foreground">
            {flag.displayName ?? flag.key}
          </h3>
          {flag.displayName && flag.displayName !== flag.key ? (
            <code className="truncate text-xs text-muted-foreground">
              {flag.key}
            </code>
          ) : null}
          <Badge
            variant={flag.rules.mode === "on" ? "secondary" : "outline"}
            className="ms-auto shrink-0"
          >
            {modeLabel(flag.rules, t)}
          </Badge>
        </div>
        {flag.description ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {flag.description}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            {t("featureFlags.enabledFor")}: {audienceLabel(flag.rules, t)}
          </span>
          {metadata ? (
            <span>{t("featureFlags.lastChanged", { metadata })}</span>
          ) : null}
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-foreground">
          {flag.enabledForCurrentUser === true ? (
            <>
              <IconCheck className="size-4 text-emerald-500" />
              {t("featureFlags.youHaveAccess")}
            </>
          ) : flag.enabledForCurrentUser === false ? (
            <>{t("featureFlags.youDoNotHaveAccess")}</>
          ) : (
            <>{t("featureFlags.currentUserUnknown")}</>
          )}
        </div>
        {error ? (
          <p className="mt-3 text-sm text-destructive">
            {t("featureFlags.mutationUnverified", {
              name: flag.displayName ?? flag.key,
            })}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 md:justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-xs"
          disabled={isPending || flag.enabledForCurrentUser === true}
          onClick={() =>
            onMutate({
              key: flag.key,
              operation: "enable-for-current-user",
            })
          }
        >
          {flag.enabledForCurrentUser === true ? (
            <IconCheck />
          ) : (
            <IconUserCheck />
          )}
          {flag.enabledForCurrentUser === true
            ? t("featureFlags.enabledForMe")
            : t("featureFlags.enableForMe")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-xs"
          disabled={isPending}
          onClick={() => setTargetingOpen(true)}
        >
          <IconSettings />
          {t("featureFlags.editTargeting")}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              disabled={isPending}
              aria-label={t("featureFlags.moreActions", {
                name: flag.displayName ?? flag.key,
              })}
            >
              <IconDots />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                disabled={flag.rules.mode === "off"}
                onSelect={() => setDisableOpen(true)}
              >
                {t("featureFlags.disableForEveryone")}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {targetingOpen ? (
        <TargetingDialog
          flag={flag}
          open
          onOpenChange={setTargetingOpen}
          onMutate={onMutate}
          isPending={isPending}
        />
      ) : null}
      <AlertDialog open={disableOpen} onOpenChange={setDisableOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("featureFlags.disableForEveryoneTitle", {
                name: flag.displayName ?? flag.key,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("featureFlags.disableForEveryoneDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("featureFlags.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => onMutate({ key: flag.key, operation: "off" })}
            >
              {t("featureFlags.disableForEveryone")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}

export function FeatureFlagsEditor({
  flags,
  onMutate,
  isPending,
  error,
  errorFlagKey,
  showHeader = true,
}: {
  flags: FeatureFlagMetadata[];
  onMutate: (input: SetFeatureFlagInput) => void;
  isPending?: boolean;
  error?: Error | null;
  errorFlagKey?: string | null;
  showHeader?: boolean;
}) {
  const t = useT();
  const sortedFlags = useMemo(
    () =>
      flags
        .map((flag) => ({
          ...flag,
          rules: normalizeFeatureFlagRules(flag.rules),
        }))
        .sort((left, right) => left.key.localeCompare(right.key)),
    [flags],
  );

  return (
    <section
      className={
        showHeader ? "mx-auto w-full max-w-2xl" : "mx-auto w-full max-w-4xl"
      }
      aria-labelledby={showHeader ? "feature-flags-title" : undefined}
      aria-label={showHeader ? undefined : t("featureFlags.title")}
    >
      {showHeader ? (
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
      ) : null}
      {sortedFlags.length ? (
        <div>
          {sortedFlags.map((flag) => (
            <FeatureFlagRow
              key={flag.key}
              flag={flag}
              onMutate={onMutate}
              isPending={isPending}
              error={errorFlagKey === flag.key ? error : null}
            />
          ))}
        </div>
      ) : (
        <p className="py-8 text-sm text-muted-foreground">
          {t("featureFlags.noFlags")}
        </p>
      )}
      {error && !errorFlagKey ? (
        <p className="pt-3 text-sm text-destructive">
          {t("featureFlags.mutationUnverifiedGeneric")}
        </p>
      ) : null}
    </section>
  );
}
