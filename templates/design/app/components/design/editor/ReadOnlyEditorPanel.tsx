import { IconLock } from "@tabler/icons-react";

export function ReadOnlyEditorPanel({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-5 text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <IconLock className="size-5" />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 max-w-56 text-xs leading-5 text-muted-foreground">
        {description}
      </p>
    </div>
  );
}
