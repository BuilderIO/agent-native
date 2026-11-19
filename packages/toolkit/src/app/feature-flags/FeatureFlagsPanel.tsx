import {
  normalizeFeatureFlagPercentage,
  normalizeFeatureFlagRules,
} from "@agent-native/core/client/feature-flags/helpers";
import type {
  FeatureFlagMetadata,
  FeatureFlagRuleScope,
  FeatureFlagRuleSummary,
  FeatureFlagRules,
  FeatureFlagStoredRule,
  SetFeatureFlagInput,
} from "@agent-native/core/client/feature-flags/types";
import { useT } from "@agent-native/core/client/i18n";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@agent-native/toolkit/ui/dialog";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@agent-native/toolkit/ui/tooltip";
import {
  IconCheck,
  IconDots,
  IconInfoCircle,
  IconSettings,
  IconLoader2,
  IconUserCheck,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";

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

function summarize(rules: FeatureFlagRules): FeatureFlagRuleSummary {
  return {
    mode: rules.mode,
    emailCount: rules.emails.length,
    orgIdCount: rules.orgIds.length,
    percentage: rules.percentage,
    updatedAt: rules.updatedAt ?? null,
  };
}

function rolloutLabel(
  audience: FeatureFlagRuleSummary,
  t: ReturnType<typeof useT>,
): string {
  if (audience.mode === "off") return t("featureFlags.off");
  if (audience.mode === "on") return t("featureFlags.everyone");
  const parts = [
    audience.emailCount
      ? t("featureFlags.emailCount", { count: audience.emailCount })
      : null,
    audience.orgIdCount
      ? t("featureFlags.organizationCount", { count: audience.orgIdCount })
      : null,
    audience.percentage
      ? t("featureFlags.percentageRollout", { count: audience.percentage })
      : null,
  ].filter(Boolean);
  return parts.join(" · ") || t("featureFlags.inherited");
}

function audienceLabel(
  audience: FeatureFlagRuleSummary,
  t: ReturnType<typeof useT>,
): string {
  if (audience.mode === "off") return t("featureFlags.off");
  if (audience.mode === "on") return t("featureFlags.everyoneAudience");
  return rolloutLabel(audience, t);
}

function modeLabel(
  audience: FeatureFlagRuleSummary,
  t: ReturnType<typeof useT>,
) {
  if (audience.mode === "off") return t("featureFlags.off");
  if (audience.mode === "on") return t("featureFlags.everyone");
  return t("featureFlags.targeted");
}

/** Who a stored rule reaches; null when it couldn't be read. */
function storedAudience(
  stored: FeatureFlagStoredRule,
): FeatureFlagRuleSummary | null {
  if (stored.state === "set")
    return summarize(normalizeFeatureFlagRules(stored.rules));
  if (stored.state === "withheld") return stored.summary;
  if (stored.state === "unreadable") return null;
  return summarize(normalizeFeatureFlagRules({ mode: "off" }));
}

function storedAudienceLabel(
  stored: FeatureFlagStoredRule,
  t: ReturnType<typeof useT>,
): string {
  const audience = storedAudience(stored);
  return audience
    ? audienceLabel(audience, t)
    : t("agentChat.featureFlags.scope.unreadable");
}

function storedRule(
  flag: FeatureFlagMetadata,
  scope: FeatureFlagRuleScope,
): FeatureFlagStoredRule | null {
  if (!flag.scopes) return null;
  return scope === "org" ? flag.scopes.org : flag.scopes.global;
}

/** Who the rule in effect reaches; null when it couldn't be read. */
function inEffectAudience(
  flag: FeatureFlagMetadata,
): FeatureFlagRuleSummary | null {
  if (flag.rules) return summarize(flag.rules);
  const inEffect = flag.scopes?.inEffect;
  const stored =
    inEffect === "org" || inEffect === "global"
      ? storedRule(flag, inEffect)
      : null;
  return stored ? storedAudience(stored) : null;
}

/** A target without `scopes` predates explicit scope and writes the caller's org. */
function manageableScopes(flag: FeatureFlagMetadata): FeatureFlagRuleScope[] {
  if (!flag.scopes) return ["org"];
  return (["org", "global"] as const).filter(
    (scope) => storedRule(flag, scope)?.canManage === true,
  );
}

const OFF_RULES = normalizeFeatureFlagRules({ mode: "off" });

/**
 * An org with no rule of its own starts from the rule it gets now. Null when
 * that rule, or the row being replaced, can't be shown: starting from Off
 * would let an unedited save silently turn the flag off.
 */
function startingRules(
  flag: FeatureFlagMetadata,
  scope: FeatureFlagRuleScope,
): FeatureFlagRules | null {
  const stored = storedRule(flag, scope);
  if (stored?.state === "set") return normalizeFeatureFlagRules(stored.rules);
  if (stored?.state === "unreadable") return null;
  if (scope === "org" && flag.scopes?.inEffect === "global")
    return flag.rules ?? null;
  return flag.rules && scope === "org" ? flag.rules : OFF_RULES;
}

/** What a scope gets now: its own rule, or for an org without one, the global rule. */
function ruleNow(
  flag: FeatureFlagMetadata,
  scope: FeatureFlagRuleScope,
): FeatureFlagStoredRule | null {
  const stored = storedRule(flag, scope);
  return stored?.state === "unset" && flag.scopes ? flag.scopes.global : stored;
}

/**
 * Adds the caller to the rule that decides their access, or to none. Writing
 * the org rule while the global rule decides would create an org rule, and
 * the org would then stop following later changes to the global rule; a rule
 * that couldn't be read has nothing to add to.
 */
function enableForMeScope(
  flag: FeatureFlagMetadata,
): FeatureFlagRuleScope | null {
  const scopes = manageableScopes(flag);
  const inEffect = flag.scopes?.inEffect;
  const target: FeatureFlagRuleScope =
    inEffect === "org" || inEffect === "global"
      ? inEffect
      : scopes.includes("global")
        ? "global"
        : "org";
  if (!scopes.includes(target)) return null;
  return storedRule(flag, target)?.state === "unreadable" ? null : target;
}

function isOff(stored: FeatureFlagStoredRule | null): boolean {
  return (
    !stored ||
    stored.state === "unset" ||
    (stored.state === "set" && stored.rules.mode === "off")
  );
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
  const scopeId = `feature-flag-${flag.key}-scope`;
  const modeId = `feature-flag-${flag.key}-mode`;
  const emailsId = `feature-flag-${flag.key}-emails`;
  const orgIdsId = `feature-flag-${flag.key}-org-ids`;
  const percentageId = `feature-flag-${flag.key}-percentage`;
  const scopes = manageableScopes(flag);
  const [scope, setScope] = useState<FeatureFlagRuleScope>(() => {
    const inEffect = flag.scopes?.inEffect;
    return (inEffect === "org" || inEffect === "global") &&
      scopes.includes(inEffect)
      ? inEffect
      : (scopes[0] ?? "org");
  });
  const [initial] = useState(() => startingRules(flag, scope));
  const start = initial ?? OFF_RULES;
  // Null until chosen when the starting rule can't be shown.
  const [mode, setMode] = useState<FeatureFlagRules["mode"] | null>(
    initial?.mode ?? null,
  );
  const [emails, setEmails] = useState(() => listText(start.emails));
  const [orgIds, setOrgIds] = useState(() => listText(start.orgIds));
  const [percentage, setPercentage] = useState(String(start.percentage));
  const orgKeepsOwnRule =
    scope === "global" &&
    !!flag.scopes?.org &&
    flag.scopes.org.state !== "unset";
  const now = ruleNow(flag, scope);
  const audience =
    mode === null
      ? now
        ? storedAudienceLabel(now, t)
        : t("agentChat.featureFlags.scope.unreadable")
      : audienceLabel(
          summarize(
            normalizeFeatureFlagRules({
              mode,
              emails: parseList(emails),
              orgIds: parseList(orgIds),
              percentage: normalizeFeatureFlagPercentage(percentage),
            }),
          ),
          t,
        );

  const changeScope = (next: FeatureFlagRuleScope) => {
    const rules = startingRules(flag, next);
    const nextStart = rules ?? OFF_RULES;
    setScope(next);
    setMode(rules?.mode ?? null);
    setEmails(listText(nextStart.emails));
    setOrgIds(listText(nextStart.orgIds));
    setPercentage(String(nextStart.percentage));
  };

  const save = () => {
    if (mode === null) return;
    const nextPercentage = normalizeFeatureFlagPercentage(percentage);
    onMutate({
      key: flag.key,
      operation: "replace-rules",
      scope,
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
          <Label htmlFor={scopeId}>
            {t("agentChat.featureFlags.scope.appliesTo")}
          </Label>
          <Select
            value={scope}
            disabled={scopes.length < 2}
            onValueChange={(value) =>
              changeScope(value as FeatureFlagRuleScope)
            }
          >
            <SelectTrigger id={scopeId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {scopes.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option === "org"
                      ? t("agentChat.featureFlags.scope.org")
                      : t("agentChat.featureFlags.scope.global")}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={modeId}>{t("featureFlags.modeLabel")}</Label>
          <Select
            value={mode ?? ""}
            onValueChange={(value) =>
              setMode(value as FeatureFlagRules["mode"])
            }
          >
            <SelectTrigger id={modeId}>
              <SelectValue placeholder={audience} />
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
          {t(
            scope === "org"
              ? "agentChat.featureFlags.scope.summaryOrg"
              : "agentChat.featureFlags.scope.summaryGlobal",
            { audience },
          )}
          {orgKeepsOwnRule ? (
            <> {t("agentChat.featureFlags.scope.orgKeepsOwnRule")}</>
          ) : null}
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
          <Button
            type="button"
            disabled={isPending || mode === null}
            onClick={save}
          >
            {isPending ? <IconLoader2 className="animate-spin" /> : null}
            {t("featureFlags.saveRules")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RuleSource({ flag }: { flag: FeatureFlagMetadata }) {
  const t = useT();
  const scopes = flag.scopes;
  if (!scopes || scopes.inEffect === "none") return null;
  if (scopes.inEffect === "global")
    return <span>{t("agentChat.featureFlags.scope.setForGlobal")}</span>;
  if (scopes.global.state === "unset")
    return <span>{t("agentChat.featureFlags.scope.setForOrg")}</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="inline-flex items-center gap-1 font-medium text-foreground"
        >
          {t("agentChat.featureFlags.scope.overridesGlobal")}
          <IconInfoCircle className="size-3.5 text-muted-foreground" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">
        {t("agentChat.featureFlags.scope.overridesGlobalTooltip", {
          audience: storedAudienceLabel(scopes.global, t),
        })}
      </TooltipContent>
    </Tooltip>
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
  const [turnOffScope, setTurnOffScope] = useState<FeatureFlagRuleScope | null>(
    null,
  );
  const rules = flag.rules;
  const audience = inEffectAudience(flag);
  const actor = rules ? formatActor(rules.updatedBy) : null;
  const when = formatWhen(audience?.updatedAt);
  const metadata = [actor, when].filter(Boolean).join(" · ");
  const scopes = manageableScopes(flag);
  const enableScope = enableForMeScope(flag);
  const isBuilderCreditReferrals =
    flag.key === "billing.builder-credit-usage-reporting";
  const displayName = isBuilderCreditReferrals
    ? t("agentChat.featureFlags.builderCreditReferrals.name", {
        defaultValue: "Builder credit referrals",
      })
    : (flag.displayName ?? flag.key);
  const description = isBuilderCreditReferrals
    ? t("agentChat.featureFlags.builderCreditReferrals.description", {
        defaultValue:
          "Show connected Builder workspace referral details in Usage.",
      })
    : flag.description;
  const name = flag.displayName ?? flag.key;

  return (
    <article
      id={`feature-flag-${flag.key}`}
      className="grid gap-4 scroll-mt-24 border-b border-border py-5 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-sm font-medium text-foreground">
            {displayName}
          </h3>
          {flag.displayName && flag.displayName !== flag.key ? (
            <code className="truncate text-xs text-muted-foreground">
              {flag.key}
            </code>
          ) : null}
          <Badge
            variant={
              !audience
                ? "destructive"
                : audience.mode === "on"
                  ? "secondary"
                  : "outline"
            }
            className="ms-auto shrink-0"
          >
            {audience
              ? modeLabel(audience, t)
              : t("agentChat.featureFlags.scope.unreadable")}
          </Badge>
        </div>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            {t("featureFlags.enabledFor")}:{" "}
            {audience
              ? audienceLabel(audience, t)
              : t("agentChat.featureFlags.scope.unreadable")}
          </span>
          <RuleSource flag={flag} />
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
            {t("featureFlags.mutationUnverified", { name })}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-xs"
              disabled={
                isPending || !enableScope || flag.enabledForCurrentUser === true
              }
              onClick={() =>
                enableScope &&
                onMutate({
                  key: flag.key,
                  operation: "enable-for-current-user",
                  scope: enableScope,
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
          </TooltipTrigger>
          {enableScope ? (
            <TooltipContent>
              {enableScope === "org"
                ? t("agentChat.featureFlags.scope.enableForMeOrg")
                : t("agentChat.featureFlags.scope.enableForMeGlobal")}
            </TooltipContent>
          ) : null}
        </Tooltip>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-xs"
          disabled={isPending || scopes.length === 0}
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
              disabled={isPending || scopes.length === 0}
              aria-label={t("featureFlags.moreActions", { name })}
            >
              <IconDots />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              {scopes.includes("org") ? (
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  disabled={audience?.mode === "off"}
                  onSelect={() => setTurnOffScope("org")}
                >
                  {t("agentChat.featureFlags.scope.turnOffOrg")}
                </DropdownMenuItem>
              ) : null}
              {scopes.includes("global") ? (
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  disabled={isOff(storedRule(flag, "global"))}
                  onSelect={() => setTurnOffScope("global")}
                >
                  {t("agentChat.featureFlags.scope.turnOffGlobal")}
                </DropdownMenuItem>
              ) : null}
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
      <AlertDialog
        open={turnOffScope !== null}
        onOpenChange={(open) => {
          if (!open) setTurnOffScope(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {turnOffScope === "global"
                ? t("agentChat.featureFlags.scope.turnOffGlobalTitle", {
                    name,
                  })
                : t("agentChat.featureFlags.scope.turnOffOrgTitle", { name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {turnOffScope === "global"
                ? t("agentChat.featureFlags.scope.turnOffGlobalDescription")
                : t("agentChat.featureFlags.scope.turnOffOrgDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("featureFlags.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                turnOffScope &&
                onMutate({
                  key: flag.key,
                  operation: "off",
                  scope: turnOffScope,
                })
              }
            >
              {turnOffScope === "global"
                ? t("agentChat.featureFlags.scope.turnOffGlobal")
                : t("agentChat.featureFlags.scope.turnOffOrg")}
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
        .filter((flag) => flag.canManage !== false)
        .map((flag) => ({
          ...flag,
          rules: flag.rules ? normalizeFeatureFlagRules(flag.rules) : undefined,
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
