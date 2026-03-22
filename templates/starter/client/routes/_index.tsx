import { useTheme } from "next-themes";

export function meta() {
  return [{ title: "Agent Native App" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
    </div>
  );
}

export default function IndexPage() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6">
      <div className="max-w-md w-full space-y-8 text-center">
        <div className="space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Your app is running
          </h1>
          <p className="text-[14px] text-muted-foreground leading-relaxed">
            Start building by editing{" "}
            <code className="text-[13px] bg-muted px-1.5 py-0.5 rounded font-mono">
              client/routes/_index.tsx
            </code>
          </p>
        </div>

        <div className="h-px bg-border" />

        <div className="grid grid-cols-2 gap-3 text-left">
          <a
            href="https://agent-native.dev/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="group rounded-lg border border-border/50 px-4 py-3 hover:bg-accent/50 transition-colors"
          >
            <p className="text-[13px] font-medium text-foreground">
              Documentation
            </p>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Learn the framework
            </p>
          </a>
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="rounded-lg border border-border/50 px-4 py-3 hover:bg-accent/50 transition-colors text-left"
          >
            <p className="text-[13px] font-medium text-foreground">Theme</p>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Toggle dark / light
            </p>
          </button>
        </div>
      </div>
    </div>
  );
}
