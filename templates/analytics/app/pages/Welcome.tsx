import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { NotionRenderer } from "@/components/notion/NotionRenderer";
import { getIdToken } from "@/lib/auth";

const PAGE_ID = "3183d7274be58007b0bec5ef910b51b4";

async function fetchNotionPage() {
  const token = await getIdToken();
  const res = await fetch(`/api/notion/page/${PAGE_ID}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error("Failed to fetch Notion page");
  return res.json();
}

function Skeleton() {
  return (
    <div className="max-w-3xl mx-auto space-y-4 animate-pulse">
      <div className="h-8 bg-muted/40 rounded w-2/3" />
      <div className="h-4 bg-muted/30 rounded w-1/3" />
      <div className="h-px bg-border my-6" />
      <div className="h-24 bg-muted/20 rounded-lg" />
      <div className="h-px bg-border my-6" />
      <div className="h-5 bg-muted/40 rounded w-1/2" />
      <div className="h-4 bg-muted/20 rounded w-full" />
      <div className="h-4 bg-muted/20 rounded w-5/6" />
      <div className="h-32 bg-muted/20 rounded-lg mt-4" />
      <div className="h-px bg-border my-6" />
      <div className="h-5 bg-muted/40 rounded w-2/5" />
      <div className="h-4 bg-muted/20 rounded w-full" />
      <div className="h-4 bg-muted/20 rounded w-4/5" />
    </div>
  );
}

export default function Welcome() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["notion-page", PAGE_ID],
    queryFn: fetchNotionPage,
    staleTime: 10 * 60 * 1000,
  });

  return (
    <Layout>
      {isLoading && <Skeleton />}
      {error && (
        <div className="max-w-3xl mx-auto text-destructive">
          Failed to load guidelines. Please try again later.
        </div>
      )}
      {data && (
        <div className="max-w-3xl mx-auto">
          <h1 className="text-3xl font-bold text-foreground mb-2">
            {data.title}
          </h1>
          <NotionRenderer blocks={data.blocks} />
        </div>
      )}
    </Layout>
  );
}
