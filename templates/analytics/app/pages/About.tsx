import {
  IconChartBar,
  IconMessage,
  IconPencil,
  IconLayoutDashboard,
  IconDatabase,
} from "@tabler/icons-react";
import { dataSources, categoryLabels, categoryOrder } from "@/lib/data-sources";

const capabilities = [
  {
    icon: IconDatabase,
    title: "Connect Data Sources",
    description:
      "Connect any of 20+ data sources — from Google Analytics and BigQuery to Stripe, HubSpot, and PostgreSQL. Each source includes a step-by-step setup guide.",
  },
  {
    icon: IconLayoutDashboard,
    title: "Create Custom Dashboards",
    description:
      "Describe the dashboard you want and the agent builds it — charts, tables, metrics, and all. A Google Analytics example is included to show what's possible.",
  },
  {
    icon: IconChartBar,
    title: "Query Explorer",
    description:
      "Use the Explorer tool to write arbitrary SQL against BigQuery and visualize results as charts or tables instantly.",
  },
  {
    icon: IconMessage,
    title: "Ask Questions in Chat",
    description:
      "Ask natural-language questions about any connected data source. Get answers, charts, and insights without writing SQL.",
  },
];

export default function About() {
  return (
    <div className="mx-auto max-w-4xl space-y-10 p-6 md:p-10">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">About This App</h1>
        <p className="mt-2 text-muted-foreground text-lg">
          Analytics gives you a single place to connect data sources, build
          custom dashboards, and ask questions across all of your key metrics.
        </p>
      </header>

      {/* Capabilities */}
      <section>
        <h2 className="text-xl font-semibold mb-4">What You Can Do</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {capabilities.map((cap) => (
            <div
              key={cap.title}
              className="rounded-lg border border-border bg-card p-5 space-y-2"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <cap.icon className="h-5 w-5" />
                </div>
                <h3 className="font-medium">{cap.title}</h3>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {cap.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Available Data Sources */}
      <section>
        <h2 className="text-xl font-semibold mb-4">Available Data Sources</h2>
        {categoryOrder.map((category) => {
          const sources = dataSources.filter((s) => s.category === category);
          if (sources.length === 0) return null;
          return (
            <div key={category} className="mb-4">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {categoryLabels[category]}
              </h3>
              <div className="grid gap-2 sm:grid-cols-3">
                {sources.map((source) => {
                  const Icon = source.icon;
                  return (
                    <div
                      key={source.id}
                      className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5"
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <Icon className="h-4 w-4" />
                      </div>
                      <span className="text-sm font-medium">{source.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>

      <footer className="text-xs text-muted-foreground pt-4 border-t border-border">
        All data is queried live from the connected sources. BigQuery queries
        are capped at 750 GB per query for cost safety.
      </footer>
    </div>
  );
}
