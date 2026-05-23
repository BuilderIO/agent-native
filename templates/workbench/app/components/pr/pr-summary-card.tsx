import {
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconDatabase,
  IconKey,
  IconTestPipe,
} from "@tabler/icons-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * AI summary card on `/prs/:owner/:repo/:n`. v1 is heuristic-driven by
 * `summarize-pr` — the model-based summarizer ships in v1.1 via the agent
 * chat. We surface the same shape both versions return so the swap is
 * non-breaking.
 */
export interface PRSummary {
  summary: string;
  risk: "low" | "med" | "high";
  riskReasons?: string[];
  schemaImpact?: string[];
  secretsHit?: string[];
  authHit?: string[];
  suggestedTests?: string[];
  generatedAt?: string;
  version?: string;
}

interface PRSummaryCardProps {
  summary: PRSummary;
  /** When true the card is collapsed by default. Defaults to expanded. */
  collapsedByDefault?: boolean;
}

export function PRSummaryCard({
  summary,
  collapsedByDefault = false,
}: PRSummaryCardProps) {
  const [open, setOpen] = useState(!collapsedByDefault);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Workbench summary
              <RiskBadge risk={summary.risk} />
            </CardTitle>
            <p className="text-sm leading-relaxed text-foreground">
              {summary.summary}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 cursor-pointer text-muted-foreground hover:text-foreground"
            aria-label={open ? "Collapse summary" : "Expand summary"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? (
              <IconChevronUp size={14} aria-hidden />
            ) : (
              <IconChevronDown size={14} aria-hidden />
            )}
          </Button>
        </div>
      </CardHeader>
      {open ? (
        <CardContent className="space-y-4 pt-0 text-sm">
          {summary.riskReasons && summary.riskReasons.length > 0 ? (
            <SummarySection
              title="Why we flagged this"
              tone="warning"
              items={summary.riskReasons}
            />
          ) : null}
          {summary.schemaImpact && summary.schemaImpact.length > 0 ? (
            <SummarySection
              icon="schema"
              title={`Schema impact (${summary.schemaImpact.length})`}
              items={summary.schemaImpact}
              mono
            />
          ) : null}
          {summary.secretsHit && summary.secretsHit.length > 0 ? (
            <SummarySection
              icon="secrets"
              title={`Secret-handling files (${summary.secretsHit.length})`}
              items={summary.secretsHit}
              mono
            />
          ) : null}
          {summary.authHit && summary.authHit.length > 0 ? (
            <SummarySection
              icon="auth"
              title={`Auth surface (${summary.authHit.length})`}
              items={summary.authHit}
              mono
            />
          ) : null}
          {summary.suggestedTests && summary.suggestedTests.length > 0 ? (
            <SummarySection
              icon="tests"
              title={`Suggested tests (${summary.suggestedTests.length})`}
              items={summary.suggestedTests}
              mono
            />
          ) : null}
          {!summary.riskReasons?.length &&
          !summary.schemaImpact?.length &&
          !summary.secretsHit?.length &&
          !summary.suggestedTests?.length ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <IconCheck size={14} className="text-emerald-500" aria-hidden />
              No risk signals from heuristics. Model-based summary lands in
              v1.1.
            </p>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}

function RiskBadge({ risk }: { risk: PRSummary["risk"] }) {
  if (risk === "high") {
    return (
      <Badge variant="destructive" className="gap-1">
        <IconAlertTriangle size={10} aria-hidden />
        HIGH risk
      </Badge>
    );
  }
  if (risk === "med") {
    return (
      <Badge
        variant="secondary"
        className="gap-1 border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
      >
        Med risk
      </Badge>
    );
  }
  return (
    <Badge
      variant="secondary"
      className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
    >
      Low risk
    </Badge>
  );
}

function SummarySection({
  title,
  tone,
  items,
  mono,
  icon,
}: {
  title: string;
  tone?: "warning";
  items: string[];
  mono?: boolean;
  icon?: "schema" | "secrets" | "auth" | "tests";
}) {
  const Icon =
    icon === "schema"
      ? IconDatabase
      : icon === "secrets"
        ? IconKey
        : icon === "tests"
          ? IconTestPipe
          : icon === "auth"
            ? IconAlertTriangle
            : null;
  return (
    <section className="space-y-1.5">
      <h4
        className={cn(
          "flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide",
          tone === "warning"
            ? "text-amber-600 dark:text-amber-400"
            : "text-muted-foreground",
        )}
      >
        {Icon ? <Icon size={12} aria-hidden /> : null}
        {title}
      </h4>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li
            key={item}
            className={cn(
              "truncate text-xs text-foreground",
              mono && "font-mono",
            )}
          >
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}
