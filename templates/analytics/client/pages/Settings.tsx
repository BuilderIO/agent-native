import { Layout } from "@/components/layout/Layout";
import { useAuth } from "@/components/auth/AuthProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ApiKeySettings } from "@agent-native/core/client";

export default function Settings() {
  const { auth } = useAuth();

  return (
    <Layout>
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
            <CardTitle className="text-base">API Keys</CardTitle>
          </CardHeader>
          <CardContent>
            <ApiKeySettings />
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-base">About</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              Analytics Dashboard is an internal tool for querying Builder.io
              metrics stored in BigQuery.
            </p>
            <p>
              Queries run directly against BigQuery. Use the Query Explorer to
              run arbitrary SQL against any table in the project.
            </p>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
