import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  ExternalLink,
  ChevronDown,
  Quote,
  Trash2,
  Sparkles,
} from "lucide-react";
import type { ResearchArticle } from "@shared/api";
import { SignalBadge } from "./SignalBadge";

interface ArticleCardProps {
  article: ResearchArticle;
  index: number;
  onDelete?: (id: string) => void;
}

export function ArticleCard({ article, index, onDelete }: ArticleCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="group rounded-lg border border-border bg-card hover:border-border/80 transition-colors">
      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start gap-3">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-muted text-[11px] font-semibold text-muted-foreground shrink-0 mt-0.5">
            {index + 1}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm font-medium text-foreground leading-snug">
                  {article.title}
                </h3>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-muted-foreground">
                    {article.author}
                  </span>
                  <span className="text-muted-foreground/40">·</span>
                  <span className="text-xs text-muted-foreground">
                    {article.source}
                  </span>
                  {article.publishedDate && (
                    <>
                      <span className="text-muted-foreground/40">·</span>
                      <span className="text-xs text-muted-foreground">
                        {article.publishedDate}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <a
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="Open article"
                >
                  <ExternalLink size={13} />
                </a>
                {onDelete && (
                  <button
                    onClick={() => onDelete(article.id)}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
                    title="Remove article"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>

            {/* Summary */}
            <p className="text-[13px] text-muted-foreground mt-2 leading-relaxed">
              {article.summary}
            </p>

            {/* Signals */}
            {article.signals.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {article.signals.map((signal, i) => (
                  <SignalBadge key={i} signal={signal} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Expandable details */}
      <div className="px-4 pb-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
        >
          <ChevronDown
            size={12}
            className={cn(
              "transition-transform duration-150",
              expanded && "rotate-180"
            )}
          />
          {expanded ? "Hide details" : "Show highlights & key quote"}
        </button>
      </div>

      {expanded && (
        <div className="px-4 pb-4 border-t border-border/50 pt-3 space-y-3">
          {/* Key Quote */}
          {article.keyQuote && (
            <div className="flex gap-2 p-3 rounded-md bg-muted/50">
              <Quote
                size={14}
                className="text-muted-foreground shrink-0 mt-0.5"
              />
              <p className="text-[13px] text-foreground/80 italic leading-relaxed">
                {article.keyQuote}
              </p>
            </div>
          )}

          {/* Highlights */}
          {article.highlights.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Sparkles size={12} className="text-amber-400" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Key Takeaways
                </span>
              </div>
              <ul className="space-y-1.5">
                {article.highlights.map((highlight, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-[13px] text-foreground/80"
                  >
                    <span className="text-muted-foreground mt-1.5 shrink-0">
                      •
                    </span>
                    <span className="leading-relaxed">{highlight}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
