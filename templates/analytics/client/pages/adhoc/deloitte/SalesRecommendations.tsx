import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function SalesRecommendations() {
  return (
    <>
      <h2 className="text-lg font-semibold mt-6">Sales Outreach Recommendations</h2>
      <Card className="bg-card border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Who to Contact</CardTitle>
          <CardDescription>Recommendations to drive Fusion adoption at Deloitte</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <Badge variant="default" className="mt-0.5 shrink-0">Priority 1</Badge>
              <div className="flex-1">
                <p className="text-sm font-medium">Activate dormant Builder users</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Deloitte has 439 users with Builder accounts but minimal Fusion usage.
                  Run a Fusion demo/training session to drive adoption across teams.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Badge variant="secondary" className="mt-0.5 shrink-0">Priority 2</Badge>
              <div className="flex-1">
                <p className="text-sm font-medium">Re-engage sayarra@deloitte.com</p>
                <p className="text-xs text-muted-foreground mt-1">
                  This user tried Fusion (Dec 2025) but hasn't returned. Check in to understand
                  their experience and address any blockers preventing continued use.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Badge variant="outline" className="mt-0.5 shrink-0">Priority 3</Badge>
              <div className="flex-1">
                <p className="text-sm font-medium">Identify champions and decision makers</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Review the 517 HubSpot contacts to find technical leaders (Engineering Manager,
                  Tech Lead, VP Engineering) who could advocate for Fusion adoption internally.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-4 p-3 bg-muted/50 rounded-lg">
            <p className="text-xs font-medium">Key Insight</p>
            <p className="text-xs text-muted-foreground mt-1">
              With minimal Fusion adoption across 439 Builder users, Deloitte represents a
              high-value expansion opportunity. Low engagement suggests lack of awareness
              or potential onboarding/training gaps.
            </p>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
