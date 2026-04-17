import { cn } from "@/lib/utils";

export interface CtaButtonProps {
  cta: {
    id: string;
    label: string;
    url: string;
    color: string;
  };
  onClick?: () => void;
  floating?: boolean;
  large?: boolean;
}

export function CtaButton({ cta, onClick, floating, large }: CtaButtonProps) {
  return (
    <a
      href={cta.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      className={cn(
        "inline-flex items-center gap-2 rounded-full font-medium text-white shadow-lg transition-all hover:shadow-xl hover:-translate-y-0.5",
        large ? "px-6 py-3 text-base" : "px-4 py-2 text-sm",
        floating && "ring-2 ring-white/20",
      )}
      style={{ backgroundColor: cta.color }}
    >
      {cta.label}
    </a>
  );
}
