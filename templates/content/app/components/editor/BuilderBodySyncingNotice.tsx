import { IconLoader2 } from "@tabler/icons-react";

export function BuilderBodySyncingNotice({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/35 px-4 py-5 text-sm">
      <div className="flex items-center gap-2 font-medium text-foreground">
        <IconLoader2 className="size-4 animate-spin text-muted-foreground" />
        {title}
      </div>
      <p className="mt-2 max-w-2xl leading-6 text-muted-foreground">
        {description}
      </p>
    </div>
  );
}
