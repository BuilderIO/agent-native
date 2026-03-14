import { cn } from "@/lib/utils";

interface TextFilterProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function TextFilter({
  label,
  value,
  onChange,
  placeholder,
  className,
}: TextFilterProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label className="text-xs text-muted-foreground font-medium">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 w-[180px] rounded-md border border-input bg-background px-2 text-xs ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </div>
  );
}
