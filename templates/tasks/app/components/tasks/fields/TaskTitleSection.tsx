import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function TaskTitleSection({
  title,
  onChange,
}: {
  title: string;
  onChange: (title: string) => void;
}) {
  return (
    <section className="grid gap-2 border-b border-border/70 px-3 py-3">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <Label className="min-w-0 truncate text-[13px] font-medium">
          Title
        </Label>
        <span className="shrink-0 text-[11px] text-muted-foreground">Task</span>
      </div>
      <Input
        value={title}
        onChange={(event) => onChange(event.currentTarget.value)}
        aria-label="Edit task title"
        className="h-9 text-[13px]"
      />
    </section>
  );
}
