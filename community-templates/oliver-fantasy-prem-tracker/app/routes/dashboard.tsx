import { LeadersPanel } from "@/components/fpl/leaders-panel";
import { LeagueTable } from "@/components/fpl/league-table";
import { NewsPanel } from "@/components/fpl/news-panel";
import { RecommendationsPanel } from "@/components/fpl/recommendations-panel";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [
    { title: APP_TITLE },
    {
      name: "description",
      content:
        "Live Fantasy Premier League table, top scorers, assisters, clean sheets, points, news, and player recommendations in one place.",
    },
  ];
}

export default function DashboardRoute() {
  return (
    <div className="mx-auto grid max-w-7xl gap-4 p-4 lg:grid-cols-3 lg:p-6">
      <div className="space-y-4 lg:col-span-2">
        <LeagueTable />
        <LeadersPanel />
      </div>
      <div className="space-y-4">
        <RecommendationsPanel />
        <NewsPanel />
      </div>
    </div>
  );
}
