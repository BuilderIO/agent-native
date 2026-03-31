import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";

export function ThemeToggle({ collapsed }: { collapsed?: boolean }) {
  const { theme, setTheme } = useTheme();

  return (
    <button
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
        collapsed && "justify-center px-0",
      )}
      title={collapsed ? "Toggle theme" : undefined}
    >
      <Sun className="h-4 w-4 rotate-0 scale-100 dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-4 w-4 rotate-90 scale-0 dark:rotate-0 dark:scale-100" />
      {!collapsed && <span>Toggle theme</span>}
    </button>
  );
}
