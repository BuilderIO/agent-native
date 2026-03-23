interface ArticlePreviewCardProps {
  title: string;
  blurb: string;
  image?: string;
  tags: string[];
  authorName?: string;
  readTime: number;
}

export function ArticlePreviewCard({
  title,
  blurb,
  image,
  tags,
  authorName,
  readTime,
}: ArticlePreviewCardProps) {
  return (
    <div className="border border-border rounded-lg overflow-hidden bg-card">
      {image && (
        <div className="aspect-video bg-muted overflow-hidden">
          <img
            src={image}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      )}
      <div className="p-4 space-y-2">
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-primary/10 text-primary"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        <h3 className="text-sm font-semibold text-foreground line-clamp-2">
          {title || "Untitled Article"}
        </h3>
        <p className="text-xs text-muted-foreground line-clamp-3">
          {blurb || "No description"}
        </p>
        <div className="flex items-center gap-3 pt-1 text-[11px] text-muted-foreground">
          {authorName && <span>{authorName}</span>}
          <span>{readTime} min read</span>
        </div>
      </div>
    </div>
  );
}
