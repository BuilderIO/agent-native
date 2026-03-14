import type { GoogleSearchResult } from "@shared/api";

interface GoogleResultCardProps {
  result: GoogleSearchResult;
  onLinkClick: (url: string) => void;
}

export function GoogleResultCard({ result, onLinkClick }: GoogleResultCardProps) {
  const breadcrumb = result.breadcrumb || formatBreadcrumb(result.url);

  return (
    <div className="py-3 group">
      {/* Breadcrumb / URL */}
      <div className="flex items-center gap-1.5 mb-0.5">
        <img
          src={`https://www.google.com/s2/favicons?domain=${result.domain}&sz=16`}
          alt=""
          className="w-4 h-4 rounded-sm"
          loading="lazy"
        />
        <cite className="text-xs text-muted-foreground not-italic truncate">
          {breadcrumb}
        </cite>
      </div>

      {/* Title */}
      <button
        onClick={() => onLinkClick(result.url)}
        className="text-left w-full"
      >
        <h3 className="text-[15px] leading-snug font-normal text-blue-600 dark:text-blue-400 hover:underline cursor-pointer line-clamp-2">
          {result.title}
        </h3>
      </button>

      {/* Description snippet */}
      {result.description && (
        <p className="text-[13px] leading-relaxed text-muted-foreground mt-0.5 line-clamp-2">
          {result.description}
        </p>
      )}
    </div>
  );
}

function formatBreadcrumb(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname;
    return `${u.hostname}${path}`;
  } catch {
    return url;
  }
}
