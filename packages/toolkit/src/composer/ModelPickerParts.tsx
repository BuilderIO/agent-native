import { Badge } from "../ui/badge.js";
import { Separator } from "../ui/separator.js";
import { cn } from "../utils.js";
import type {
  ComposerModelDescription,
  ComposerTranslate,
} from "./runtime-adapters.js";

export function RecommendedBadge({ t }: { t: ComposerTranslate }) {
  return (
    <Badge
      variant="outline"
      size="sm"
      className="shrink-0 text-muted-foreground"
    >
      {t("agentChat.composer.effortDefaultBadge", {
        defaultValue: "Recommended",
      })}
    </Badge>
  );
}

export function localizedModelDescription(
  t: ComposerTranslate,
  description: ComposerModelDescription | undefined,
): string | undefined {
  if (!description?.description) return undefined;
  return description.catalogId
    ? t(`agentChat.composer.modelDescription.${description.catalogId}`, {
        defaultValue: description.description,
      })
    : description.description;
}

export function modelBillingLabel(
  t: ComposerTranslate,
  description: ComposerModelDescription | undefined,
): string | undefined {
  const billing = description?.billing;
  if (!billing) return undefined;
  switch (billing.kind) {
    case "builder-credits":
      return t("agentChat.composer.billingBuilderCredits", {
        defaultValue: "Uses Builder credits",
      });
    case "provider-key":
      return t("agentChat.composer.billingProviderKey", {
        defaultValue: "Billed to your {{provider}} key",
        provider: billing.provider,
      });
    case "subscription":
      return t("agentChat.composer.billingSubscription", {
        defaultValue: "Uses your {{plan}} plan",
        plan: billing.plan,
      });
  }
}

/** Whether the hover card has anything to say beyond the row's own name. */
export function hasModelDetails(
  description: ComposerModelDescription | undefined,
): description is ComposerModelDescription {
  return Boolean(
    description &&
    (description.description ||
      description.ratings ||
      description.contextWindow !== undefined ||
      description.billing),
  );
}

const RATING_SEGMENTS = [1, 2, 3, 4, 5] as const;

export function ModelRatingMeter({
  label,
  value,
  t,
}: {
  label: string;
  value: number;
  t: ComposerTranslate;
}) {
  return (
    <>
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        role="meter"
        aria-valuemin={1}
        aria-valuemax={5}
        aria-valuenow={value}
        aria-label={t("agentChat.composer.modelRatingAria", {
          defaultValue: "{{label}} {{value}} of 5",
          label,
          value,
        })}
        className="flex items-center justify-end gap-1"
      >
        {RATING_SEGMENTS.map((segment) => (
          <span
            key={segment}
            aria-hidden="true"
            className={cn(
              "h-1.5 w-5 rounded-full",
              segment <= value ? "bg-ring" : "bg-muted",
            )}
          />
        ))}
      </span>
    </>
  );
}

export function ModelDetailsCard({
  name,
  description,
  t,
  formatNumber,
}: {
  name: string;
  description: ComposerModelDescription;
  t: ComposerTranslate;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
}) {
  const summary = localizedModelDescription(t, description);
  const billing = modelBillingLabel(t, description);
  const ratings = description.ratings;
  const contextWindow = description.contextWindow;
  return (
    <div data-agent-composer-model-card="">
      <p className="text-sm font-medium text-foreground">{name}</p>
      {summary ? (
        <p className="mt-1 text-sm text-muted-foreground">{summary}</p>
      ) : null}
      {ratings ? (
        <>
          <Separator className="my-3" />
          <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2.5">
            <ModelRatingMeter
              t={t}
              label={t("agentChat.composer.modelCost", {
                defaultValue: "Cost",
              })}
              value={ratings.cost}
            />
            <ModelRatingMeter
              t={t}
              label={t("agentChat.composer.modelReasoning", {
                defaultValue: "Reasoning",
              })}
              value={ratings.reasoning}
            />
            <ModelRatingMeter
              t={t}
              label={t("agentChat.composer.modelSpeed", {
                defaultValue: "Speed",
              })}
              value={ratings.speed}
            />
          </div>
        </>
      ) : null}
      {contextWindow !== undefined ? (
        <>
          <Separator className="my-3" />
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="text-muted-foreground">
              {t("agentChat.composer.contextWindow", {
                defaultValue: "Context window",
              })}
            </span>
            <span className="text-foreground tabular-nums">
              {t("agentChat.composer.tokenCount", {
                defaultValue: "{{count}} tokens",
                count: formatNumber(contextWindow, {
                  notation: "compact",
                  maximumFractionDigits: 2,
                }),
              })}
            </span>
          </div>
        </>
      ) : null}
      {billing ? (
        <p className="mt-2 text-xs text-muted-foreground">{billing}</p>
      ) : null}
    </div>
  );
}
