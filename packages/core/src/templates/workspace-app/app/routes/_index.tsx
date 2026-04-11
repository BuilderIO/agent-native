import { useTheme } from "next-themes";
import { AuthenticatedLayout } from "@{{WORKSPACE_NAME}}/core-module/client";

// App title — replaced at scaffold time by the create-workspace CLI.
const APP_TITLE = "{{APP_TITLE}}";

export function meta() {
  return [{ title: APP_TITLE }];
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
    <AuthenticatedLayout>
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6">
        <div className="max-w-md w-full space-y-8 text-center">
          <div className="space-y-3">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {APP_TITLE} is running
            </h1>
            <p className="text-[14px] text-muted-foreground leading-relaxed">
              This app inherits its auth, agent chat, skills, and instructions
              from{" "}
              <code className="text-[13px] bg-muted px-1.5 py-0.5 rounded font-mono">
                packages/core-module
              </code>
              . Edit{" "}
              <code className="text-[13px] bg-muted px-1.5 py-0.5 rounded font-mono">
                app/routes/_index.tsx
              </code>{" "}
              to build your own screens; anything cross-cutting goes in the
              workspace core module instead.
            </p>
          </div>

          <div className="h-px bg-border" />

          <div className="grid grid-cols-2 gap-3 text-left">
            <a
              href="https://agent-native.com/docs/enterprise-workspace"
              target="_blank"
              rel="noopener noreferrer"
              className="group rounded-lg border border-border/50 px-4 py-3 hover:bg-accent/50 transition-colors"
            >
              <p className="text-[13px] font-medium text-foreground">
                Workspace guide
              </p>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                How the three layers work
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
    </AuthenticatedLayout>
  );
}
