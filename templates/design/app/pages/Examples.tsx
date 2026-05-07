import {
  IconArrowRight,
  IconChartAreaLine,
  IconDeviceMobile,
  IconShoppingCart,
  IconUser,
  IconLayoutDashboard,
  IconListCheck,
  IconRocket,
} from "@tabler/icons-react";
import { useNavigate } from "react-router";
import { nanoid } from "nanoid";
import { useActionMutation } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useSetPageTitle } from "@/components/layout/HeaderActions";
import { cn } from "@/lib/utils";

const EXAMPLES = [
  {
    title: "Todo App",
    description: "Interactive task manager prototype with drag-and-drop lists",
    icon: IconListCheck,
    thumbnail: "todo",
    prompt:
      "Create a high-fidelity prototype of a todo app with drag-and-drop task lists, categories, and a clean minimal design.",
  },
  {
    title: "Landing Page",
    description: "Marketing landing page with hero section, features, and CTA",
    icon: IconRocket,
    thumbnail: "landing",
    prompt:
      "Design a modern startup landing page with a bold hero section, feature grid, testimonials, and a clear call-to-action. Use a dark theme.",
  },
  {
    title: "Dashboard",
    description: "Admin dashboard with charts, tables, and key metrics",
    icon: IconLayoutDashboard,
    thumbnail: "dashboard",
    prompt:
      "Create an admin dashboard design with a sidebar navigation, key metric cards, a line chart, a bar chart, and a data table.",
  },
  {
    title: "Mobile App",
    description: "iOS app onboarding flow with multi-step screens",
    icon: IconDeviceMobile,
    thumbnail: "mobile",
    prompt:
      "Design an iOS mobile app onboarding flow with 4 screens: welcome, feature highlights, permissions request, and account creation.",
  },
  {
    title: "E-commerce",
    description: "Product page with image gallery, reviews, and cart",
    icon: IconShoppingCart,
    thumbnail: "commerce",
    prompt:
      "Create a product detail page for an e-commerce store with an image gallery, size selector, reviews section, and add-to-cart button.",
  },
  {
    title: "Portfolio",
    description: "Personal portfolio website with project showcase",
    icon: IconUser,
    thumbnail: "portfolio",
    prompt:
      "Design a personal portfolio website with a hero section, project grid with hover previews, about section, and contact form.",
  },
];

const pendingGenerationKey = (id: string) => `design.pending-generation.${id}`;

export default function Examples() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const createMutation = useActionMutation("create-design");

  useSetPageTitle("Examples");

  const handleUsePrompt = (example: (typeof EXAMPLES)[number]) => {
    const id = nanoid();
    const title = example.title;
    const now = new Date().toISOString();

    queryClient.setQueryData(
      ["action", "list-designs", undefined],
      (old: any) => ({
        count: (old?.count ?? 0) + 1,
        designs: [
          {
            id,
            title,
            projectType: "prototype",
            designSystemId: null,
            createdAt: now,
            updatedAt: now,
          },
          ...(old?.designs ?? []),
        ],
      }),
    );

    void createMutation
      .mutateAsync({
        id,
        title,
        projectType: "prototype",
      } as any)
      .catch(() => {
        try {
          window.sessionStorage.removeItem(pendingGenerationKey(id));
        } catch {
          // Storage may be unavailable.
        }
        queryClient.invalidateQueries({
          queryKey: ["action", "list-designs"],
        });
      });

    try {
      window.sessionStorage.setItem(
        pendingGenerationKey(id),
        JSON.stringify({
          prompt: example.prompt,
          files: [],
          title,
          source: example.title,
        }),
      );
    } catch {
      // Storage may be unavailable; the editor still opens with the design.
    }

    navigate(`/design/${id}`);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="mb-8">
          <p className="text-sm text-muted-foreground">
            Pick a template to get started quickly, or use it as inspiration for
            your own design.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {EXAMPLES.map((example) => {
            const Icon = example.icon;
            return (
              <div
                key={example.title}
                className="group overflow-hidden rounded-lg border border-border bg-card"
              >
                <div className="relative aspect-video overflow-hidden border-b border-border bg-muted/40">
                  <ExampleThumbnail
                    kind={example.thumbnail}
                    className="absolute inset-0"
                  />
                  <div className="absolute left-3 top-3 flex h-8 w-8 items-center justify-center rounded-md border border-white/70 bg-white/85 text-slate-800 shadow-sm dark:border-white/10 dark:bg-black/35 dark:text-white">
                    <Icon className="h-4 w-4" />
                  </div>
                </div>

                <div className="p-4">
                  <h3 className="font-medium text-sm text-foreground/90 mb-1">
                    {example.title}
                  </h3>
                  <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
                    {example.description}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleUsePrompt(example)}
                    className="w-full cursor-pointer"
                  >
                    Use this prompt
                    <IconArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}

function ExampleThumbnail({
  kind,
  className,
}: {
  kind: string;
  className?: string;
}) {
  return (
    <div className={cn("p-4", className)}>
      {kind === "todo" && <TodoThumbnail />}
      {kind === "landing" && <LandingThumbnail />}
      {kind === "dashboard" && <DashboardThumbnail />}
      {kind === "mobile" && <MobileThumbnail />}
      {kind === "commerce" && <CommerceThumbnail />}
      {kind === "portfolio" && <PortfolioThumbnail />}
    </div>
  );
}

function TodoThumbnail() {
  const columns = [
    { accent: "bg-[#e7d7f8]", highlight: false },
    { accent: "bg-[#d4ecdf]", highlight: true },
    { accent: "bg-[#fde6bb]", highlight: false },
  ];

  return (
    <div className="h-full rounded-lg bg-[#f7f3ea] p-3 text-[#23302f] shadow-inner">
      <div className="mb-3 h-3 w-24 rounded bg-[#23302f]" />
      <div className="grid h-[calc(100%-1.25rem)] grid-cols-3 gap-2">
        {columns.map((column, i) => (
          <div key={column.accent} className="rounded-md bg-white/70 p-2">
            <div className={cn("mb-2 h-2 w-10 rounded", column.accent)} />
            {[0, 1, 2].map((n) => (
              <div
                key={n}
                className={cn(
                  "mb-1.5 h-4 rounded border border-black/5 bg-white",
                  column.highlight && n === 0 && "bg-[#23302f]/10",
                )}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function LandingThumbnail() {
  return (
    <div className="h-full overflow-hidden rounded-lg bg-[#0d1412] p-3 text-white shadow-inner">
      <div className="mb-5 flex items-center justify-between">
        <div className="h-2 w-14 rounded bg-white/80" />
        <div className="flex gap-1">
          <div className="h-2 w-6 rounded bg-white/30" />
          <div className="h-2 w-6 rounded bg-white/30" />
        </div>
      </div>
      <div className="grid grid-cols-[1.2fr_0.8fr] gap-3">
        <div>
          <div className="mb-2 h-4 w-28 rounded bg-[#e5ff72]" />
          <div className="mb-1.5 h-2 w-24 rounded bg-white/35" />
          <div className="mb-3 h-2 w-20 rounded bg-white/25" />
          <div className="h-5 w-16 rounded bg-white" />
        </div>
        <div className="rounded-md border border-white/10 bg-white/10 p-2">
          <div className="h-full rounded bg-[#e5ff72]/80" />
        </div>
      </div>
    </div>
  );
}

function DashboardThumbnail() {
  const bars = ["h-[18px]", "h-[28px]", "h-[22px]", "h-[34px]"];

  return (
    <div className="grid h-full grid-cols-[42px_1fr] overflow-hidden rounded-lg bg-[#eef2f1] text-[#17201e] shadow-inner">
      <div className="bg-[#17201e] p-2">
        <div className="mb-3 h-4 rounded bg-white/80" />
        {[0, 1, 2, 3].map((n) => (
          <div key={n} className="mb-2 h-2 rounded bg-white/25" />
        ))}
      </div>
      <div className="p-3">
        <div className="mb-2 grid grid-cols-3 gap-2">
          {[0, 1, 2].map((n) => (
            <div key={n} className="h-8 rounded bg-white shadow-sm" />
          ))}
        </div>
        <div className="grid grid-cols-[1fr_72px] gap-2">
          <div className="rounded bg-white p-2">
            <IconChartAreaLine className="h-full w-full text-[#2f8f83]" />
          </div>
          <div className="space-y-1 rounded bg-white p-2">
            {bars.map((heightClass, i) => (
              <div
                key={i}
                className={cn(
                  "inline-block w-2 rounded-sm bg-[#f0b65a]",
                  heightClass,
                )}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MobileThumbnail() {
  return (
    <div className="flex h-full items-center justify-center bg-[#dfe9ff]">
      <div className="h-full w-20 rounded-[18px] border-[5px] border-[#101828] bg-white p-2 shadow-lg">
        <div className="mx-auto mb-3 h-1 w-7 rounded bg-[#101828]" />
        <div className="mb-2 h-12 rounded-xl bg-[#6d80ff]" />
        <div className="mb-2 h-2 w-12 rounded bg-[#101828]" />
        <div className="mb-1 h-2 rounded bg-slate-200" />
        <div className="mb-4 h-2 w-10 rounded bg-slate-200" />
        <div className="h-5 rounded-full bg-[#101828]" />
      </div>
    </div>
  );
}

function CommerceThumbnail() {
  return (
    <div className="grid h-full grid-cols-[0.9fr_1.1fr] gap-3 rounded-lg bg-[#fff7ed] p-3 shadow-inner">
      <div className="rounded-lg bg-[#f4c7ab] p-2">
        <div className="h-full rounded-md border border-white/45 bg-white/20" />
      </div>
      <div className="py-1">
        <div className="mb-2 h-3 w-20 rounded bg-[#33251e]" />
        <div className="mb-3 h-2 w-28 rounded bg-[#33251e]/25" />
        <div className="mb-3 flex gap-1.5">
          {[0, 1, 2].map((n) => (
            <div key={n} className="h-5 w-5 rounded-full bg-white shadow-sm" />
          ))}
        </div>
        <div className="mb-2 h-6 rounded bg-[#33251e]" />
        <div className="grid grid-cols-2 gap-1">
          <div className="h-2 rounded bg-[#33251e]/20" />
          <div className="h-2 rounded bg-[#33251e]/20" />
        </div>
      </div>
    </div>
  );
}

function PortfolioThumbnail() {
  return (
    <div className="h-full rounded-lg bg-[#f2f5f0] p-3 shadow-inner">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <div className="mb-1 h-3 w-20 rounded bg-[#253126]" />
          <div className="h-2 w-14 rounded bg-[#253126]/25" />
        </div>
        <div className="h-9 w-9 rounded-full bg-[#b9d8a6]" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="h-16 rounded-md bg-[#253126]" />
        <div className="h-16 rounded-md bg-[#d7b98f]" />
        <div className="h-16 rounded-md bg-[#9cb6c8]" />
      </div>
    </div>
  );
}
