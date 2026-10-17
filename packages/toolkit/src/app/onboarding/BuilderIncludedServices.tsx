import { useT } from "@agent-native/core/client/i18n";
import type { OnboardingCapability } from "@agent-native/core/onboarding/types";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@agent-native/toolkit/ui/collapsible";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@agent-native/toolkit/ui/tooltip";
import {
  IconCheck,
  IconChevronDown,
  IconInfoCircle,
} from "@tabler/icons-react";

type CapabilityTranslator = (
  key: string,
  options?: Record<string, unknown>,
) => string;

export function getBuilderIncludedCapabilities(
  capabilities: OnboardingCapability[],
) {
  return capabilities.filter(
    (capability) =>
      capability.builderIncluded &&
      (!!capability.service ||
        capability.required ||
        !!capability.suggested ||
        !!capability.builderOnly),
  );
}

function capabilityCopy(
  t: CapabilityTranslator,
  capability: OnboardingCapability,
) {
  return {
    label: capability.labelKey
      ? t(capability.labelKey, { defaultValue: capability.label })
      : capability.label,
    why: capability.whyKey
      ? t(capability.whyKey, { defaultValue: capability.why })
      : null,
  };
}

export function CapabilityInfoButton({
  label,
  why,
}: {
  label: string;
  why: string;
}) {
  const t = useT();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={t("agentChat.onboarding.capability.about", {
            defaultValue: "About {{label}}",
            label,
          })}
          className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <IconInfoCircle size={13} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs">
        {why}
      </TooltipContent>
    </Tooltip>
  );
}

function CapabilityRows({
  capabilities,
}: {
  capabilities: OnboardingCapability[];
}) {
  const t = useT();

  return (
    <TooltipProvider>
      {capabilities.map((capability) => {
        const copy = capabilityCopy(t, capability);
        return (
          <div
            key={capability.id}
            className="flex items-center gap-2 rounded-md px-2 py-1"
          >
            <IconCheck
              aria-hidden="true"
              className="shrink-0 text-muted-foreground"
              size={15}
            />
            <span className="text-xs text-foreground">{copy.label}</span>
            {copy.why ? (
              <CapabilityInfoButton label={copy.label} why={copy.why} />
            ) : null}
          </div>
        );
      })}
    </TooltipProvider>
  );
}

export function BuilderIncludedServices({
  capabilities,
  collapsible = false,
  loading = false,
  error,
  testId,
}: {
  capabilities: OnboardingCapability[];
  collapsible?: boolean;
  loading?: boolean;
  error?: string | null;
  testId?: string;
}) {
  const t = useT();

  if (!collapsible && capabilities.length === 0) return null;
  if (collapsible && !loading && !error && capabilities.length === 0)
    return null;

  const content = loading ? (
    <div className="grid gap-2 py-1" aria-label={t("agentChat.common.loading")}>
      <Skeleton className="h-5 w-4/5" />
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-5 w-3/4" />
    </div>
  ) : error ? (
    <p role="status" className="py-1 text-xs text-muted-foreground">
      {error}
    </p>
  ) : (
    <CapabilityRows capabilities={capabilities} />
  );

  if (collapsible) {
    return (
      <Collapsible
        defaultOpen={false}
        className="border-t border-border/60"
        data-testid={testId}
      >
        <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 py-3 text-left text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          {t("agentChat.onboarding.builderIncludedServices", {
            defaultValue: "Included services",
          })}
          <IconChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180"
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="grid gap-1 pb-1">
          {content}
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <p className="text-sm text-muted-foreground/70">What&rsquo;s included</p>
      <CapabilityRows capabilities={capabilities} />
    </div>
  );
}

export function BuilderIncludedBenefitsDisclosure({
  capabilities,
  includedLabel,
  creditsLabel,
  loading = false,
  loadingLabel,
  error,
  testId,
}: {
  capabilities: OnboardingCapability[];
  includedLabel: string;
  creditsLabel: string;
  loading?: boolean;
  loadingLabel: string;
  error?: string | null;
  testId?: string;
}) {
  const t = useT();
  const additionalServices = capabilities.filter(
    (capability) => capability.id !== "llm" && capability.service !== "model",
  );
  const canExpand = loading || !!error || additionalServices.length > 0;
  const serviceList = loading ? (
    <div className="grid gap-2 py-1" aria-label={loadingLabel}>
      <Skeleton className="h-5 w-4/5" />
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-5 w-3/4" />
    </div>
  ) : error ? (
    <p role="status" className="py-1 text-xs text-muted-foreground">
      {error}
    </p>
  ) : (
    <CapabilityRows capabilities={additionalServices} />
  );
  const moreServicesLabel = t("agentChat.onboarding.builderMoreServices", {
    defaultValue: "+ {{count}} more services",
    count: additionalServices.length,
  });

  const summary = (
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-[13px] font-semibold text-foreground">
        {includedLabel}
      </span>
      <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
        {creditsLabel}
      </span>
      {additionalServices.length > 0 ? (
        <span className="text-xs font-medium text-foreground dark:text-white">
          {moreServicesLabel}
        </span>
      ) : null}
    </span>
  );

  if (!canExpand) {
    return (
      <div className="rounded-[10px] bg-emerald-50 px-4 py-3 dark:bg-emerald-950/30">
        {summary}
      </div>
    );
  }

  return (
    <Collapsible
      defaultOpen={false}
      className="overflow-hidden rounded-[10px] bg-emerald-50 dark:bg-emerald-950/30"
      data-testid={testId}
    >
      <CollapsibleTrigger className="group flex w-full items-start justify-between gap-3 px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {summary}
        <IconChevronDown
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-0 bg-muted px-2 py-2">
        {serviceList}
      </CollapsibleContent>
    </Collapsible>
  );
}
