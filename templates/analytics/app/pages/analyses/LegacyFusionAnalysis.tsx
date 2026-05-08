import { useEffect, type ComponentType, type ReactNode } from "react";
import { captureError } from "@agent-native/core/client";
import {
  IconAlertTriangle,
  IconChecks,
  IconCurrencyDollar,
  IconDatabase,
  IconMessageCircle,
  IconRefresh,
  IconTargetArrow,
  IconTrendingDown,
  IconTrophy,
  IconUsers,
} from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type TablerIcon = ComponentType<{ className?: string }>;

interface AnalysisLike {
  id: string;
  name: string;
  resultData: Record<string, unknown> | null;
}

interface LegacyFusionBase {
  type: "closed-lost" | "closed-won";
  generatedAt?: string;
  analysisAsOf?: string;
  summary?: Record<string, unknown>;
}

interface LegacyDeal {
  dealId?: string;
  dealName: string;
  amount?: number;
  closeDate?: string;
  furthestStage?: string;
  closedLostReason?: string;
  primaryReason?: string;
  gongCallCount?: number;
  matchedCallCount?: number;
  contactCount?: number;
  emailCount?: number;
  slackMessageCount?: number;
  personaCount?: number;
}

interface PainTheme {
  rank?: number;
  number?: number;
  theme?: string;
  title?: string;
  pain?: string;
  detail?: string;
  description?: string;
  businessImpact?: string;
  deals?: number;
  dealCount?: number;
  value?: number;
  pct?: number;
  representativeDeals?: string[];
  examples?: string[];
}

interface PainDeal {
  dealId?: string;
  dealName: string;
  amount?: number;
  businessPain?: string;
  operationalPain?: string;
  assessedPainSummary?: string;
  painCategories?: string[];
}

interface WinTheme {
  number: number;
  title: string;
  detail: string;
  deals: string[];
}

interface ClosedLostPayload extends LegacyFusionBase {
  type: "closed-lost";
  deals?: LegacyDeal[];
  stageData?: Array<{
    stage: string;
    deals: number;
    value: number;
    avgDeal?: number;
  }>;
  lossThemes?: PainTheme[];
  businessPain?: {
    generatedAt?: string;
    totalDeals?: number;
    topPains?: PainTheme[];
    businessPains?: PainTheme[];
    deals?: PainDeal[];
  };
}

interface ClosedWonPayload extends LegacyFusionBase {
  type: "closed-won";
  deals?: LegacyDeal[];
  winThemes?: WinTheme[];
  operationalThemes?: WinTheme[];
  businessThemes?: WinTheme[];
  personas?: Array<{
    dealId?: string;
    dealName?: string;
    email?: string;
    name?: string;
    company?: string;
  }>;
}

type LegacyFusionPayload = ClosedLostPayload | ClosedWonPayload;

const LEGACY_FUSION_ANALYSIS_IDS = new Set([
  "fusion-closed-lost-analysis",
  "fusion-closed-won-analysis",
]);

export function isLegacyFusionAnalysis(id: string): boolean {
  return LEGACY_FUSION_ANALYSIS_IDS.has(id);
}

export default function LegacyFusionAnalysis({
  analysis,
}: {
  analysis: AnalysisLike;
}) {
  const payload = parseLegacyFusionPayload(analysis.resultData);

  useEffect(() => {
    if (!isLegacyFusionAnalysis(analysis.id) || payload) return;
    captureError(
      new Error(`Missing legacy Fusion payload for analysis ${analysis.id}`),
      {
        tags: {
          surface: "analytics-analysis-detail",
          analysisId: analysis.id,
          issue: "missing-legacy-fusion-payload",
        },
        extra: {
          analysisName: analysis.name,
          resultDataKeys: analysis.resultData
            ? Object.keys(analysis.resultData)
            : [],
        },
      },
    );
  }, [analysis.id, analysis.name, analysis.resultData, payload]);

  if (!isLegacyFusionAnalysis(analysis.id)) return null;

  if (!payload) {
    return (
      <Card className="border-amber-200 bg-amber-50 text-amber-950 shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <IconAlertTriangle className="h-5 w-5" />
            Legacy Fusion payload missing
          </CardTitle>
          <CardDescription className="text-amber-900">
            This migrated analysis is a legacy React dashboard, but its compact
            dashboard payload is not present in SQL. Sentry has captured this
            state so the migration can be repaired instead of silently showing a
            text placeholder.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return payload.type === "closed-lost" ? (
    <ClosedLostDashboard data={payload} />
  ) : (
    <ClosedWonDashboard data={payload} />
  );
}

function parseLegacyFusionPayload(
  resultData: Record<string, unknown> | null,
): LegacyFusionPayload | null {
  const value = resultData?.legacyFusion;
  if (!value || typeof value !== "object") return null;
  const payload = value as Partial<LegacyFusionPayload>;
  if (payload.type !== "closed-lost" && payload.type !== "closed-won") {
    return null;
  }
  return payload as LegacyFusionPayload;
}

function ClosedLostDashboard({ data }: { data: ClosedLostPayload }) {
  const deals = data.deals ?? [];
  const totalValue = sumBy(deals, (deal) => deal.amount);
  const stageData = data.stageData?.length
    ? data.stageData
    : summarizeStages(deals);
  const topDeals = [...deals]
    .sort((a, b) => valueOf(b.amount) - valueOf(a.amount))
    .slice(0, 12);
  const reEngageDeals = deals
    .filter((deal) => isLikelyReEngage(deal))
    .sort((a, b) => valueOf(b.amount) - valueOf(a.amount))
    .slice(0, 12);
  const lossThemes = data.lossThemes ?? [];
  const topPains = data.businessPain?.topPains ?? [];
  const businessPains = data.businessPain?.businessPains ?? [];
  const painDeals = data.businessPain?.deals ?? [];

  return (
    <div className="space-y-6">
      <DashboardHero
        eyebrow="Fusion closed lost"
        title="Loss reasons, stage leakage, and re-engagement paths"
        description="Migrated from the legacy Fusion dashboard with compact Gong, HubSpot, Slack, and business-pain evidence preserved in SQL."
        icon={IconTrendingDown}
        generatedAt={data.generatedAt}
      />

      <MetricGrid>
        <MetricCard
          icon={IconDatabase}
          label="Closed-lost deals"
          value={formatNumber(
            getMetric(data.summary, "totalDeals") ?? deals.length,
          )}
          detail={`${formatNumber(getMetric(data.summary, "dealsWithCalls") ?? 0)} with Gong coverage`}
        />
        <MetricCard
          icon={IconCurrencyDollar}
          label="Lost pipeline"
          value={formatCurrency(totalValue)}
          detail={`${formatCurrency(deals.length ? totalValue / deals.length : 0)} average deal`}
        />
        <MetricCard
          icon={IconMessageCircle}
          label="Customer evidence"
          value={formatNumber(
            getMetric(data.summary, "totalCallsMatched") ?? 0,
          )}
          detail={`${formatNumber(getMetric(data.summary, "transcriptsFetched") ?? 0)} transcripts, ${formatNumber(getMetric(data.summary, "emailsFetched") ?? 0)} emails`}
        />
        <MetricCard
          icon={IconRefresh}
          label="Re-engage candidates"
          value={formatNumber(reEngageDeals.length)}
          detail="Ranked by deal size and explicit revisit signals"
        />
      </MetricGrid>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="themes">Loss themes</TabsTrigger>
          <TabsTrigger value="pain">Business pain</TabsTrigger>
          <TabsTrigger value="reengage">Re-engage</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <TwoColumn>
            <SectionCard
              title="Stage leakage"
              description="Where closed-lost value reached before the opportunity stopped."
            >
              <BarList
                rows={stageData.map((stage) => ({
                  label: stage.stage,
                  value: stage.deals,
                  detail: `${formatCurrency(stage.value)} pipeline`,
                  percent: percentage(stage.value, totalValue),
                }))}
              />
            </SectionCard>
            <SectionCard
              title="Largest losses"
              description="Highest-value closed-lost opportunities in the preserved dataset."
            >
              <DealTable
                deals={topDeals}
                columns={["deal", "amount", "stage", "calls"]}
              />
            </SectionCard>
          </TwoColumn>
        </TabsContent>

        <TabsContent value="themes" className="space-y-4">
          <ThemeGrid themes={lossThemes} variant="loss" />
        </TabsContent>

        <TabsContent value="pain" className="space-y-4">
          <TwoColumn>
            <SectionCard
              title="Operational pains"
              description="Recurring day-to-day friction across lost deals."
            >
              <ThemeStack themes={topPains} />
            </SectionCard>
            <SectionCard
              title="Business pains"
              description="Economic and strategic impact attached to the same accounts."
            >
              <ThemeStack themes={businessPains} />
            </SectionCard>
          </TwoColumn>
          <SectionCard
            title="Pain by deal"
            description="Compact evidence preserved from the business-pain enrichment file."
          >
            <PainDealTable deals={painDeals.slice(0, 12)} />
          </SectionCard>
        </TabsContent>

        <TabsContent value="reengage" className="space-y-4">
          <SectionCard
            title="Best re-engagement paths"
            description="Deals with revisit language, delayed timing, inherited-pipeline cleanup, or post-security reopen signals."
          >
            <DealTable
              deals={reEngageDeals}
              columns={["deal", "amount", "stage", "reason", "calls"]}
            />
          </SectionCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ClosedWonDashboard({ data }: { data: ClosedWonPayload }) {
  const deals = data.deals ?? [];
  const totalValue = sumBy(deals, (deal) => deal.amount);
  const topDeals = [...deals]
    .sort((a, b) => valueOf(b.amount) - valueOf(a.amount))
    .slice(0, 12);
  const personas = data.personas ?? [];
  const personaCompanies = countBy(
    personas,
    (persona) => persona.company || "Unknown",
  );
  const winThemes = data.winThemes ?? [];

  return (
    <div className="space-y-6">
      <DashboardHero
        eyebrow="Fusion closed won"
        title="What turned technical interest into signed new business"
        description="Migrated from the legacy Fusion closed-won dashboard with compact deal, Gong, Slack, email, and persona evidence preserved in SQL."
        icon={IconTrophy}
        generatedAt={data.generatedAt}
      />

      <MetricGrid>
        <MetricCard
          icon={IconChecks}
          label="Closed-won deals"
          value={formatNumber(
            getMetric(data.summary, "totalDeals") ?? deals.length,
          )}
          detail={`${formatNumber(getMetric(data.summary, "dealsWithCalls") ?? 0)} with Gong coverage`}
        />
        <MetricCard
          icon={IconCurrencyDollar}
          label="Won ARR"
          value={formatCurrency(totalValue)}
          detail={`${formatCurrency(deals.length ? totalValue / deals.length : 0)} average deal`}
        />
        <MetricCard
          icon={IconMessageCircle}
          label="Evidence captured"
          value={formatNumber(
            getMetric(data.summary, "totalCallsMatched") ?? 0,
          )}
          detail={`${formatNumber(getMetric(data.summary, "emailsFetched") ?? 0)} emails, ${formatNumber(getMetric(data.summary, "slackMessagesFound") ?? 0)} Slack messages`}
        />
        <MetricCard
          icon={IconUsers}
          label="Buyer personas"
          value={formatNumber(personas.length)}
          detail={`${formatNumber(personaCompanies.length)} company/persona groups`}
        />
      </MetricGrid>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="themes">Win themes</TabsTrigger>
          <TabsTrigger value="pain">Pain themes</TabsTrigger>
          <TabsTrigger value="coverage">Coverage</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <TwoColumn>
            <SectionCard
              title="Won deals"
              description="Closed-won Fusion opportunities ranked by ARR."
            >
              <DealTable
                deals={topDeals}
                columns={["deal", "amount", "closeDate", "calls"]}
              />
            </SectionCard>
            <SectionCard
              title="Persona coverage"
              description="Buyer and stakeholder company coverage from the preserved persona map."
            >
              <BarList
                rows={personaCompanies.slice(0, 8).map(([label, count]) => ({
                  label,
                  value: count,
                  detail: `${formatNumber(count)} contacts`,
                  percent: percentage(count, personas.length),
                }))}
              />
            </SectionCard>
          </TwoColumn>
        </TabsContent>

        <TabsContent value="themes" className="space-y-4">
          <ThemeGrid themes={winThemes} variant="win" />
        </TabsContent>

        <TabsContent value="pain" className="space-y-4">
          <TwoColumn>
            <SectionCard
              title="Operational themes"
              description="The workflow frictions that opened the buying motion."
            >
              <ThemeStack themes={data.operationalThemes ?? []} />
            </SectionCard>
            <SectionCard
              title="Business themes"
              description="The executive-level stakes attached to those frictions."
            >
              <ThemeStack themes={data.businessThemes ?? []} />
            </SectionCard>
          </TwoColumn>
        </TabsContent>

        <TabsContent value="coverage" className="space-y-4">
          <SectionCard
            title="Evidence coverage by deal"
            description="Gong, email, Slack, contact, and persona coverage preserved from the matched dataset."
          >
            <DealTable
              deals={topDeals}
              columns={[
                "deal",
                "amount",
                "calls",
                "emails",
                "slack",
                "contacts",
              ]}
            />
          </SectionCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DashboardHero({
  eyebrow,
  title,
  description,
  icon: Icon,
  generatedAt,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: TablerIcon;
  generatedAt?: string;
}) {
  return (
    <section className="rounded-lg border bg-gradient-to-br from-background via-background to-muted/60 p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <Badge variant="secondary" className="w-fit gap-1">
            <Icon className="h-3.5 w-3.5" />
            {eyebrow}
          </Badge>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          </div>
        </div>
        {generatedAt && (
          <div className="flex shrink-0 items-center gap-2 rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground">
            <IconRefresh className="h-4 w-4" />
            Data refreshed {formatShortDate(generatedAt)}
          </div>
        )}
      </div>
    </section>
  );
}

function MetricGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: TablerIcon;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card className="shadow-none">
      <CardContent className="flex items-start gap-3 p-4">
        <div className="rounded-md bg-primary/10 p-2 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {detail}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function TwoColumn({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 xl:grid-cols-2">{children}</div>;
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card className="shadow-none">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {description && (
          <CardDescription className="text-xs leading-5">
            {description}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="p-4 pt-2">{children}</CardContent>
    </Card>
  );
}

function BarList({
  rows,
}: {
  rows: Array<{
    label: string;
    value: number;
    detail: string;
    percent: number;
  }>;
}) {
  if (!rows.length) return <EmptyState label="No rows available" />;
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.label} className="space-y-1.5">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium">{row.label}</span>
            <span className="shrink-0 text-muted-foreground">{row.detail}</span>
          </div>
          <Progress value={row.percent} className="h-2" />
        </div>
      ))}
    </div>
  );
}

function ThemeGrid({
  themes,
  variant,
}: {
  themes: Array<PainTheme | WinTheme>;
  variant: "loss" | "win";
}) {
  if (!themes.length) return <EmptyState label="No themes available" />;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {themes.map((theme, index) => {
        const title = getThemeTitle(theme);
        const detail = getThemeDetail(theme);
        const examples = getThemeExamples(theme);
        const metric =
          "value" in theme && theme.value
            ? formatCurrency(theme.value)
            : "dealCount" in theme && theme.dealCount
              ? `${formatNumber(theme.dealCount)} deals`
              : "deals" in theme && typeof theme.deals === "number"
                ? `${formatNumber(theme.deals)} deals`
                : null;
        return (
          <SectionCard
            key={`${variant}-${title}-${index}`}
            title={`${getThemeNumber(theme, index)}. ${title}`}
            description={detail}
          >
            <div className="space-y-3">
              {metric && (
                <Badge variant="outline" className="gap-1">
                  <IconTargetArrow className="h-3.5 w-3.5" />
                  {metric}
                </Badge>
              )}
              {!!examples.length && (
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {examples.slice(0, 4).map((example) => (
                    <li key={example} className="leading-5">
                      {example}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </SectionCard>
        );
      })}
    </div>
  );
}

function ThemeStack({ themes }: { themes: Array<PainTheme | WinTheme> }) {
  if (!themes.length) return <EmptyState label="No themes available" />;
  return (
    <div className="space-y-4">
      {themes.slice(0, 6).map((theme, index) => {
        const title = getThemeTitle(theme);
        const detail = getThemeDetail(theme);
        const count =
          "dealCount" in theme && theme.dealCount
            ? theme.dealCount
            : "deals" in theme && typeof theme.deals === "number"
              ? theme.deals
              : undefined;
        return (
          <div key={`${title}-${index}`} className="space-y-1.5">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium leading-5">
                {getThemeNumber(theme, index)}. {title}
              </p>
              {count ? (
                <Badge variant="secondary" className="shrink-0">
                  {formatNumber(count)}
                </Badge>
              ) : null}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">{detail}</p>
          </div>
        );
      })}
    </div>
  );
}

function DealTable({
  deals,
  columns,
}: {
  deals: LegacyDeal[];
  columns: Array<
    | "deal"
    | "amount"
    | "stage"
    | "reason"
    | "closeDate"
    | "calls"
    | "emails"
    | "slack"
    | "contacts"
  >;
}) {
  if (!deals.length) return <EmptyState label="No deals available" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
            {columns.map((column) => (
              <th key={column} className="px-2 py-2 font-medium">
                {columnLabels[column]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {deals.map((deal) => (
            <tr
              key={deal.dealId ?? deal.dealName}
              className="border-b last:border-0"
            >
              {columns.map((column) => (
                <td key={column} className="max-w-[320px] px-2 py-3 align-top">
                  {renderDealCell(deal, column)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PainDealTable({ deals }: { deals: PainDeal[] }) {
  if (!deals.length) return <EmptyState label="No pain rows available" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-2 py-2 font-medium">Deal</th>
            <th className="px-2 py-2 font-medium">Amount</th>
            <th className="px-2 py-2 font-medium">Operational pain</th>
            <th className="px-2 py-2 font-medium">Business pain</th>
          </tr>
        </thead>
        <tbody>
          {deals.map((deal) => (
            <tr
              key={deal.dealId ?? deal.dealName}
              className="border-b last:border-0"
            >
              <td className="px-2 py-3 align-top font-medium">
                {deal.dealName}
              </td>
              <td className="px-2 py-3 align-top">
                {formatCurrency(deal.amount)}
              </td>
              <td className="max-w-[360px] px-2 py-3 align-top text-muted-foreground">
                {deal.operationalPain || deal.assessedPainSummary || "Unknown"}
              </td>
              <td className="max-w-[360px] px-2 py-3 align-top text-muted-foreground">
                {deal.businessPain || "Unknown"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex min-h-28 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
      {label}
    </div>
  );
}

const columnLabels = {
  deal: "Deal",
  amount: "Amount",
  stage: "Stage",
  reason: "Reason",
  closeDate: "Closed",
  calls: "Calls",
  emails: "Emails",
  slack: "Slack",
  contacts: "Contacts",
} as const;

function renderDealCell(
  deal: LegacyDeal,
  column: keyof typeof columnLabels,
): ReactNode {
  switch (column) {
    case "deal":
      return <span className="font-medium">{deal.dealName}</span>;
    case "amount":
      return formatCurrency(deal.amount);
    case "stage":
      return deal.furthestStage || "Unknown";
    case "reason":
      return (
        <span className="line-clamp-3 text-muted-foreground">
          {deal.primaryReason || deal.closedLostReason || "Unknown"}
        </span>
      );
    case "closeDate":
      return deal.closeDate ? formatShortDate(deal.closeDate) : "Unknown";
    case "calls":
      return formatNumber(deal.gongCallCount ?? deal.matchedCallCount ?? 0);
    case "emails":
      return formatNumber(deal.emailCount ?? 0);
    case "slack":
      return formatNumber(deal.slackMessageCount ?? 0);
    case "contacts":
      return formatNumber(deal.contactCount ?? 0);
    default:
      return null;
  }
}

function getMetric(
  summary: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const raw = summary?.[key];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const numeric = Number(raw.replace(/[%,$]/g, ""));
    return Number.isFinite(numeric) ? numeric : undefined;
  }
  return undefined;
}

function summarizeStages(deals: LegacyDeal[]) {
  const byStage = new Map<
    string,
    { stage: string; deals: number; value: number }
  >();
  for (const deal of deals) {
    const stage = deal.furthestStage || "Unknown";
    const existing = byStage.get(stage) ?? { stage, deals: 0, value: 0 };
    existing.deals += 1;
    existing.value += valueOf(deal.amount);
    byStage.set(stage, existing);
  }
  return [...byStage.values()].sort((a, b) => b.value - a.value);
}

function isLikelyReEngage(deal: LegacyDeal): boolean {
  const text =
    `${deal.closedLostReason ?? ""} ${deal.primaryReason ?? ""}`.toLowerCase();
  return [
    "re-engage",
    "reengage",
    "revisit",
    "re-open",
    "reopen",
    "q3",
    "later",
    "security approval",
    "not ready",
    "timing",
  ].some((token) => text.includes(token));
}

function getThemeTitle(theme: PainTheme | WinTheme): string {
  if ("title" in theme && theme.title) return theme.title;
  if ("theme" in theme && theme.theme) return theme.theme;
  if ("pain" in theme && theme.pain) return theme.pain;
  return "Untitled theme";
}

function getThemeDetail(theme: PainTheme | WinTheme): string {
  if ("detail" in theme && theme.detail) return theme.detail;
  if ("description" in theme && theme.description) return theme.description;
  if ("businessImpact" in theme && theme.businessImpact)
    return theme.businessImpact;
  return "";
}

function getThemeExamples(theme: PainTheme | WinTheme): string[] {
  if ("examples" in theme && Array.isArray(theme.examples))
    return theme.examples;
  if (
    "representativeDeals" in theme &&
    Array.isArray(theme.representativeDeals)
  ) {
    return theme.representativeDeals;
  }
  if ("deals" in theme && Array.isArray(theme.deals)) return theme.deals;
  return [];
}

function getThemeNumber(theme: PainTheme | WinTheme, index: number): number {
  if ("number" in theme && typeof theme.number === "number")
    return theme.number;
  if ("rank" in theme && typeof theme.rank === "number") return theme.rank;
  return index + 1;
}

function countBy<T>(items: T[], keyFn: (item: T) => string) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function sumBy<T>(items: T[], valueFn: (item: T) => number | undefined) {
  return items.reduce((sum, item) => sum + valueOf(valueFn(item)), 0);
}

function percentage(value: number, total: number): number {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
}

function valueOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

function formatCurrency(value: number | undefined): string {
  const amount = valueOf(value);
  if (Math.abs(amount) >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(amount) >= 1_000) {
    return `$${Math.round(amount / 1_000)}K`;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
