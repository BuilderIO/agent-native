import { useT } from "@agent-native/core/client/i18n";
import type { OnboardingCapability } from "@agent-native/core/onboarding/types";
import { WORKSPACE_SERVICES } from "@agent-native/core/onboarding/workspace-services";
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

const BUILDER_SERVICE_WHY_KEYS: Record<string, string> = {
  llm: "agentChat.onboarding.capability.llm.why",
  "file-storage": "agentChat.onboarding.capability.fileStorage.why",
  "design-system-intelligence": "agentChat.settingsInfra.whyDesignSystem",
  "system-one": "agentChat.onboarding.capability.systemOne.why",
};

function isBuilderIncludedCapability(capability: OnboardingCapability) {
  return (
    capability.builderIncluded &&
    (!!capability.service ||
      capability.required ||
      !!capability.suggested ||
      !!capability.builderOnly)
  );
}

export function getBuilderIncludedBenefitCapabilities(
  capabilities: OnboardingCapability[],
) {
  const designSystemService = WORKSPACE_SERVICES.find(
    (service) => service.id === "design-system-intelligence",
  );
  const completeCapabilities =
    designSystemService &&
    !capabilities.some((capability) =>
      designSystemService.capabilityIds.includes(capability.id),
    )
      ? [
          ...capabilities,
          {
            ...designSystemService.capability,
            service: designSystemService.id,
            builderOnly: true,
          },
        ]
      : capabilities;

  return completeCapabilities.filter(isBuilderIncludedCapability);
}

function CapabilityInfoButton({ label, why }: { label: string; why: string }) {
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

function BuilderBenefitRows({
  capabilities,
}: {
  capabilities: OnboardingCapability[];
}) {
  const t = useT();

  return (
    <TooltipProvider>
      {capabilities.map((capability) => {
        const label = capability.labelKey
          ? t(
              capability.id === "llm"
                ? "agentChat.onboarding.builderLlmCredits"
                : capability.labelKey,
              { defaultValue: capability.label },
            )
          : capability.label;
        const whyKey =
          capability.whyKey ?? BUILDER_SERVICE_WHY_KEYS[capability.id];
        const why = whyKey ? t(whyKey, { defaultValue: capability.why }) : null;

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
            <span className="text-xs text-foreground">{label}</span>
            {why ? <CapabilityInfoButton label={label} why={why} /> : null}
          </div>
        );
      })}
    </TooltipProvider>
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
    (capability) => capability.id === "llm" || capability.service !== "model",
  );
  const canExpand = loading || !!error || additionalServices.length > 0;
  const includesLlmCredits = additionalServices.some(
    (capability) => capability.id === "llm",
  );
  const otherServiceCount =
    additionalServices.length - Number(includesLlmCredits);
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
    <BuilderBenefitRows capabilities={additionalServices} />
  );
  const moreServicesLabel = includesLlmCredits
    ? otherServiceCount > 0
      ? t("agentChat.onboarding.builderLlmCreditsAndMoreServices", {
          defaultValue: "LLM credits + {{count}} more services",
          count: otherServiceCount,
        })
      : t("agentChat.onboarding.builderLlmCredits", {
          defaultValue: "LLM credits",
        })
    : t("agentChat.onboarding.builderMoreServices", {
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
