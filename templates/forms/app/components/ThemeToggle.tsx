import { useT } from "@agent-native/core/client/i18n";
import { IconSun, IconMoon } from "@tabler/icons-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const t = useT();
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(isDark ? "light" : "dark")}
          className={cn(
            "relative text-muted-foreground before:absolute before:-inset-1.5",
            className,
          )}
        >
          <span className="relative inline-flex h-4 w-4 items-center justify-center">
            <IconSun
              className={cn(
                "absolute inset-0 h-4 w-4 transition-[opacity,filter,scale] duration-200 ease-[cubic-bezier(0.2,0,0,1)]",
                isDark
                  ? "scale-100 opacity-100 blur-none"
                  : "scale-[0.25] opacity-0 blur-[4px]",
              )}
            />
            <IconMoon
              className={cn(
                "absolute inset-0 h-4 w-4 transition-[opacity,filter,scale] duration-200 ease-[cubic-bezier(0.2,0,0,1)]",
                isDark
                  ? "scale-[0.25] opacity-0 blur-[4px]"
                  : "scale-100 opacity-100 blur-none",
              )}
            />
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("root.toggleTheme")}</TooltipContent>
    </Tooltip>
  );
}
