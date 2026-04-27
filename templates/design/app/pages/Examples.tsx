import { Link } from "react-router";
import {
  IconArrowLeft,
  IconArrowRight,
  IconLayoutGrid,
  IconCode,
  IconDeviceMobile,
  IconShoppingCart,
  IconUser,
  IconChartBar,
} from "@tabler/icons-react";
import {
  AgentSidebar,
  AgentToggleButton,
  sendToAgentChat,
  openAgentSidebar,
} from "@agent-native/core/client";
import { Button } from "@/components/ui/button";

const EXAMPLES = [
  {
    title: "Todo App",
    description: "Interactive task manager prototype with drag-and-drop lists",
    icon: IconLayoutGrid,
    prompt:
      "Create a high-fidelity prototype of a todo app with drag-and-drop task lists, categories, and a clean minimal design.",
  },
  {
    title: "Landing Page",
    description: "Marketing landing page with hero section, features, and CTA",
    icon: IconCode,
    prompt:
      "Design a modern startup landing page with a bold hero section, feature grid, testimonials, and a clear call-to-action. Use a dark theme.",
  },
  {
    title: "Dashboard",
    description: "Admin dashboard with charts, tables, and key metrics",
    icon: IconChartBar,
    prompt:
      "Create an admin dashboard design with a sidebar navigation, key metric cards, a line chart, a bar chart, and a data table.",
  },
  {
    title: "Mobile App",
    description: "iOS app onboarding flow with multi-step screens",
    icon: IconDeviceMobile,
    prompt:
      "Design an iOS mobile app onboarding flow with 4 screens: welcome, feature highlights, permissions request, and account creation.",
  },
  {
    title: "E-commerce",
    description: "Product page with image gallery, reviews, and cart",
    icon: IconShoppingCart,
    prompt:
      "Create a product detail page for an e-commerce store with an image gallery, size selector, reviews section, and add-to-cart button.",
  },
  {
    title: "Portfolio",
    description: "Personal portfolio website with project showcase",
    icon: IconUser,
    prompt:
      "Design a personal portfolio website with a hero section, project grid with hover previews, about section, and contact form.",
  },
];

export default function Examples() {
  const handleUsePrompt = (prompt: string) => {
    openAgentSidebar();
    sendToAgentChat({ message: prompt, submit: true });
  };

  return (
    <AgentSidebar
      position="right"
      emptyStateText="Pick an example or describe your own design"
      suggestions={[
        "Create a social media app prototype",
        "Design a SaaS pricing page",
        "Build a music player interface",
      ]}
    >
      <div className="min-h-screen bg-[hsl(240,6%,4%)]">
        {/* Header */}
        <header className="border-b border-white/[0.06]">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link
                to="/"
                className="flex items-center gap-1.5 text-sm text-white/50 hover:text-white/80 py-2"
              >
                <IconArrowLeft className="w-4 h-4" />
                Back
              </Link>
              <span className="text-base font-semibold text-white/90 tracking-tight">
                Examples
              </span>
            </div>
            <AgentToggleButton />
          </div>
        </header>

        {/* Content */}
        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
          <div className="mb-8">
            <h1 className="text-lg font-semibold text-white/90 mb-1">
              Starter Examples
            </h1>
            <p className="text-sm text-white/40">
              Pick a template to get started quickly, or use it as inspiration
              for your own design.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {EXAMPLES.map((example) => {
              const Icon = example.icon;
              return (
                <div
                  key={example.title}
                  className="group rounded-xl border border-white/[0.06] bg-[hsl(240,5%,8%)] overflow-hidden"
                >
                  {/* Preview area */}
                  <div className="aspect-video bg-white/[0.03] flex items-center justify-center">
                    <Icon className="w-10 h-10 text-white/10 group-hover:text-white/15" />
                  </div>
                  {/* Info */}
                  <div className="p-4">
                    <h3 className="font-medium text-sm text-white/80 mb-1">
                      {example.title}
                    </h3>
                    <p className="text-xs text-white/40 mb-3 line-clamp-2">
                      {example.description}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleUsePrompt(example.prompt)}
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
    </AgentSidebar>
  );
}
