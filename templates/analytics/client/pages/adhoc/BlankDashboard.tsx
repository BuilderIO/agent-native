import { FlaskConical } from "lucide-react";

export default function BlankDashboard() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 mb-6">
        <FlaskConical className="h-8 w-8 text-primary" />
      </div>
      <h3 className="text-lg font-semibold mb-2">Empty Dashboard</h3>
      <p className="text-sm text-muted-foreground max-w-md">
        This dashboard is empty. Tell the AI assistant what charts and data you
        want to see here — for example, "show me signups by attribution source
        over the last 90 days" — and it will populate this dashboard for you.
      </p>
    </div>
  );
}
