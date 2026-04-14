import { useAuth } from "@/components/auth/AuthProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "react-router";

export default function Settings() {
  const { auth } = useAuth();

  return (
    <div className="space-y-6 max-w-2xl">
      <h2 className="text-2xl font-bold tracking-tight">Settings</h2>

      <Card className="bg-card border-border/50">
        <CardHeader>
          <CardTitle className="text-base">Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {auth && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Signed in as
              </span>
              <span className="text-sm font-medium">{auth.email}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card border-border/50">
        <CardHeader>
          <CardTitle className="text-base">Data Source Credentials</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            API keys and credentials are managed on the Data Sources page.
          </p>
          <Button variant="outline" size="sm" asChild>
            <Link to="/data-sources">Manage Data Sources</Link>
          </Button>
        </CardContent>
      </Card>

      <Card className="bg-card border-border/50">
        <CardHeader>
          <CardTitle className="text-base">About</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Analytics is a tool for connecting data sources and building custom
            dashboards. Connect Google Analytics, BigQuery, Stripe, and more —
            then ask the agent to create dashboards.
          </p>
          <p>
            Use the Data Sources page to manage connections. Use the Query
            Explorer for ad-hoc BigQuery SQL.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
