import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber, formatPercent } from "../top-funnel/types";
import { cn } from "@/lib/utils";

const MEDAL_COLORS = [
  "from-yellow-500/20 to-yellow-600/5 border-yellow-500/30",
  "from-gray-300/20 to-gray-400/5 border-gray-400/30",
  "from-amber-700/20 to-amber-800/5 border-amber-700/30",
];

const MEDAL_LABELS = ["1st", "2nd", "3rd"];

interface AuthorCardsProps {
  rows: Record<string, unknown>[];
  isLoading?: boolean;
  error?: string;
  seoTotals?: Record<string, { etv: number; keywords: number }>;
}

export function AuthorCards({
  rows,
  isLoading,
  error,
  seoTotals,
}: AuthorCardsProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-36 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-400 py-4 text-center">{error}</p>;
  }

  if (!rows.length) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        No author data
      </p>
    );
  }

  const authors = rows.map((r) => {
    const author = String(r.author ?? "Unknown");
    const seo = seoTotals?.[author];
    return {
      author,
      new_visitors: Number(r.new_visitors ?? 0),
      signups: Number(r.signups ?? 0),
      signup_rate: Number(r.signup_rate ?? 0),
      article_count: Number(r.article_count ?? 0),
      seo_etv: seo?.etv ?? 0,
      seo_keywords: seo?.keywords ?? 0,
    };
  });

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex gap-3 min-w-max">
        {authors.map((a, i) => (
          <Card
            key={a.author}
            className={cn(
              "bg-gradient-to-br border min-w-[200px]",
              i < 3 ? MEDAL_COLORS[i] : "from-card to-card border-border/50",
            )}
          >
            <CardContent className="pt-4 pb-4 px-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold truncate">
                  {a.author}
                </span>
                {i < 3 && (
                  <span className="text-xs font-bold text-muted-foreground">
                    {MEDAL_LABELS[i]}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                <Stat
                  label="Signups"
                  value={formatNumber(a.signups)}
                  highlight
                />
                <Stat label="Traffic" value={formatNumber(a.new_visitors)} />
                <Stat label="Signup %" value={formatPercent(a.signup_rate)} />
                <Stat label="Articles" value={formatNumber(a.article_count)} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
  blue,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  blue?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
        {label}
      </p>
      <p
        className={cn(
          "text-sm font-semibold tabular-nums",
          highlight && "text-emerald-400",
          blue && "text-blue-400",
        )}
      >
        {value}
      </p>
    </div>
  );
}
