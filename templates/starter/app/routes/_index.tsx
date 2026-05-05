import { useState } from "react";
import { Link } from "react-router";
import {
  IconArrowUpRight,
  IconBolt,
  IconBook2,
  IconBrush,
  IconPlus,
} from "@tabler/icons-react";
import { useTheme } from "next-themes";
import {
  PromptComposer,
  openAgentSidebar,
  sendToAgentChat,
} from "@agent-native/core/client";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { useSetPageTitle } from "@/components/layout/HeaderActions";

export function meta() {
  return [
    { title: "Agent-Native Starter" },
    {
      name: "description",
      content:
        "Build apps where the AI agent and UI are equal partners — sharing state, actions, and context in real time.",
    },
  ];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <Spinner className="size-8 text-foreground" />
    </div>
  );
}

export default function IndexPage() {
  useSetPageTitle("Home");
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [startOpen, setStartOpen] = useState(false);

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    openAgentSidebar();
    sendToAgentChat({
      message: trimmed,
      context:
        "The user is starting from the Agent-Native starter template and wants you to customize this app. Make the requested app changes directly in the starter template code.",
      submit: true,
      type: "code",
    });
    setStartOpen(false);
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex flex-1 flex-col items-center justify-start px-6 pt-12 pb-10 md:pt-16">
        <div className="w-full max-w-2xl space-y-6">
          <div className="space-y-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-card shadow-sm">
              <IconBolt className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                Blank app
              </h1>
              <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
                This app is ready for your first route, workflow, data model, or
                custom screen.
              </p>
            </div>
          </div>

          <Popover open={startOpen} onOpenChange={setStartOpen}>
            <PopoverTrigger asChild>
              <button className="group flex w-full items-center gap-4 rounded-xl border border-dashed border-border bg-card px-5 py-4 text-left shadow-sm transition-colors hover:border-foreground/20 hover:bg-accent/40">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:text-foreground">
                  <IconBrush className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">
                    Start building
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Tell the agent what this blank app should become.
                  </span>
                </span>
                <IconArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="center"
              sideOffset={10}
              className="w-[calc(100vw-2rem)] rounded-xl p-3 shadow-xl sm:w-[420px]"
            >
              <p className="px-1 pb-2 text-sm font-semibold text-foreground">
                Start building
              </p>
              <PromptComposer
                autoFocus
                placeholder="Describe what you want to add or change..."
                draftScope="starter:start-building"
                onSubmit={(text) => submit(text)}
              />
            </PopoverContent>
          </Popover>

          <div className="h-px bg-border" />

          <div className="grid gap-3 text-left sm:grid-cols-3">
            <Link
              to="/new-app"
              className="group rounded-lg border border-border/50 px-4 py-3 hover:bg-accent/50"
            >
              <p className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                <IconPlus className="h-3.5 w-3.5" />
                New app
              </p>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                Create a separate workspace app
              </p>
            </Link>
            <a
              href="https://agent-native.com/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="group rounded-lg border border-border/50 px-4 py-3 hover:bg-accent/50"
            >
              <p className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                <IconBook2 className="h-3.5 w-3.5" />
                Documentation
              </p>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                Learn the framework
              </p>
            </a>
            <button
              onClick={() => setTheme(isDark ? "light" : "dark")}
              className="rounded-lg border border-border/50 px-4 py-3 hover:bg-accent/50 text-left cursor-pointer"
            >
              <p className="text-[13px] font-medium text-foreground">Theme</p>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                Toggle dark / light
              </p>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
