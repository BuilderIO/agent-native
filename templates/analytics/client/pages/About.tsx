import { Layout } from "@/components/layout/Layout";
import {
  Database,
  BarChart3,
  MessageSquare,
  PencilLine,
  LayoutDashboard,
  Globe,
  TrendingUp,
  Users,
  ShoppingCart,
  FileText,
  Twitter,
  Search,
  Headset,
  Phone,
  UserSearch,
  Bug,
  Activity,
  Cloud,
  Ticket,
  GitPullRequest,
  CreditCard,
} from "lucide-react";

const dataSources = [
  { name: "BigQuery Analytics", icon: Database },
  { name: "Product & Revenue", icon: TrendingUp },
  { name: "CRM & Sales (HubSpot)", icon: ShoppingCart },
  { name: "Amplitude (via BigQuery)", icon: Users },
  { name: "Content & SEO", icon: FileText },
  { name: "SEO Metrics (DataForSEO)", icon: Search },
  { name: "Social (Twitter/X)", icon: Twitter },
  { name: "Engineering Metrics", icon: Globe },
  { name: "GitHub (PRs & Issues)", icon: GitPullRequest },
  { name: "Support Tickets (Pylon)", icon: Headset },
  { name: "Sales Calls (Gong)", icon: Phone },
  { name: "Contact Enrichment (Apollo)", icon: UserSearch },
  { name: "Error Tracking (Sentry)", icon: Bug },
  { name: "Monitoring (Grafana)", icon: Activity },
  { name: "Google Cloud", icon: Cloud },
  { name: "Slack", icon: MessageSquare },
  { name: "Jira Tickets", icon: Ticket },
  { name: "Billing (Stripe)", icon: CreditCard },
];

const capabilities = [
  {
    icon: LayoutDashboard,
    title: "Pre-built Dashboards",
    description:
      "Browse ready-made dashboards covering top-funnel acquisition, product KPIs, revenue, signup growth, content SEO, HubSpot sales, and more.",
  },
  {
    icon: PencilLine,
    title: "Create & Edit Dashboards",
    description:
      "Build your own custom dashboards with charts, tables, and metrics. Edit existing ones to tailor the view to your needs.",
  },
  {
    icon: BarChart3,
    title: "Custom Charts & Queries",
    description:
      "Use the Query Explorer to write arbitrary BigQuery SQL and visualize results as charts or tables instantly.",
  },
  {
    icon: MessageSquare,
    title: "Ask Questions in Chat",
    description:
      "Ask natural-language questions about any of the connected data sources directly in the chat. Get answers, charts, and insights without writing SQL.",
  },
];

export default function About() {
  return (
    <Layout>
      <div className="mx-auto max-w-4xl space-y-10 p-6 md:p-10">
        <header>
          <h1 className="text-3xl font-bold tracking-tight">About This App</h1>
          <p className="mt-2 text-muted-foreground text-lg">
            Analytics gives you a single place to explore, visualize, and ask
            questions across all of Builder.io's key data sources.
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

        {/* Data Sources */}
        <section>
          <h2 className="text-xl font-semibold mb-4">
            Connected Data & Sources
          </h2>
          <div className="grid gap-2 sm:grid-cols-3">
            {dataSources.map((source) => {
              const Icon = source.icon;
              return (
                <div
                  key={source.name}
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
        </section>

        <footer className="text-xs text-muted-foreground pt-4 border-t border-border">
          All data is queried live from the connected sources. BigQuery queries
          are capped at 750 GB per query for cost safety.
        </footer>
      </div>
    </Layout>
  );
}
