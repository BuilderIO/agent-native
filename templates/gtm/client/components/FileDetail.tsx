import { useQuery } from "@tanstack/react-query";
import { SimpleMarkdown } from "./SimpleMarkdown";
import type { FileContent } from "@shared/api";
import { cn } from "@/lib/utils";

export function FileDetail({ path }: { path: string }) {
  const isMarkdown = path.toLowerCase().endsWith(".md");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["file", path],
    queryFn: async (): Promise<FileContent> => {
      const res = await fetch(`/api/files/${path}`);
      if (!res.ok) throw new Error("Not found");
      return res.json() as Promise<FileContent>;
    },
    enabled: Boolean(path),
  });

  if (!path) {
    return (
      <div className="p-8 text-sm text-muted-foreground">Select a file from the workspace.</div>
    );
  }

  if (isLoading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading file…</div>;
  }

  if (isError || !data) {
    return (
      <div className="p-8 text-sm text-destructive">
        Could not load <span className="font-mono">{path}</span>.
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6 border-b border-border pb-4">
        <h1 className="truncate font-mono text-sm text-muted-foreground">{data.path}</h1>
      </div>
      {isMarkdown ? (
        <SimpleMarkdown source={data.content} className="max-w-3xl" />
      ) : (
        <pre
          className={cn(
            "overflow-x-auto rounded-md border border-border bg-muted/30 p-4 font-mono text-xs leading-relaxed",
            "text-foreground/90",
          )}
        >
          {data.content}
        </pre>
      )}
    </div>
  );
}
