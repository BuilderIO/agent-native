import {
  IconArrowRight,
  IconLayoutGrid,
  IconCode,
  IconDeviceMobile,
  IconShoppingCart,
  IconUser,
  IconChartBar,
} from "@tabler/icons-react";
import { sendToAgentChat, openAgentSidebar } from "@agent-native/core/client";
import { Button } from "@/components/ui/button";
import { useSetPageTitle } from "@/components/layout/HeaderActions";

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
  useSetPageTitle("Examples");

  const handleUsePrompt = (prompt: string) => {
    openAgentSidebar();
    sendToAgentChat({ message: prompt });
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
                className="group rounded-xl border border-border bg-card overflow-hidden"
              >
                {/* Preview area */}
                <div className="aspect-video bg-muted/50 flex items-center justify-center">
                  <Icon className="w-10 h-10 text-muted-foreground/40 group-hover:text-muted-foreground/40" />
                </div>
                {/* Info */}
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
  );
}
