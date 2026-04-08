import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  showIcon?: boolean;
}

export function Logo({ className, showIcon = false }: LogoProps) {
  if (showIcon) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
      >
        {/* Simple geometric mark - stylized "N" made of two bars */}
        <path
          d="M7 17V7L17 17V7"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  // Stylized text logo
  return (
    <span className={cn("font-logo font-bold tracking-tight", className)}>
      <span className="text-foreground">nutri</span>
      <span className="text-foreground/50">track</span>
    </span>
  );
}
