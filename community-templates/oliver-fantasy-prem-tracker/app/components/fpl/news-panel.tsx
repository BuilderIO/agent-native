import { useActionQuery } from "@agent-native/core/client/hooks";
import { IconExternalLink } from "@tabler/icons-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function formatPubDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function safeHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    // coercion-ok: an unparseable URL is treated as no safe link, not a successful one.
    return null;
  }
}

export function NewsPanel() {
  const { data, isLoading, isError } = useActionQuery(
    "get-fpl-news",
    { limit: 8 },
    { refetchInterval: 5 * 60_000 },
  );
  const news = data?.news ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>FPL news</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive">
            Couldn't load the latest news. Try again shortly.
          </p>
        ) : (
          <ul className="space-y-3">
            {news.map((item) => {
              const href = safeHttpsUrl(item.link);
              return (
                <li key={item.link}>
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="group flex items-start gap-2 text-sm"
                    >
                      <span className="flex-1 font-medium leading-snug group-hover:underline">
                        {item.title}
                      </span>
                      <IconExternalLink className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    </a>
                  ) : (
                    <span className="flex-1 block font-medium leading-snug text-sm">
                      {item.title}
                    </span>
                  )}
                  {formatPubDate(item.pubDate) ? (
                    <span className="text-xs text-muted-foreground">
                      {formatPubDate(item.pubDate)}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
