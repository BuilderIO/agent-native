import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { adHocAnalyses } from "../registry";
import { BarChart3, Calendar, ArrowRight } from "lucide-react";

export default function AdHocAnalysesIndex() {
  const sortedAnalyses = [...adHocAnalyses].sort((a, b) => {
    const dateA = a.dateCreated ? new Date(a.dateCreated) : new Date(0);
    const dateB = b.dateCreated ? new Date(b.dateCreated) : new Date(0);
    return dateB.getTime() - dateA.getTime(); // Newest first
  });

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "Date unknown";
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString("en-US", { 
        year: "numeric", 
        month: "long", 
        day: "numeric" 
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Ad Hoc Analyses</h1>
        <p className="text-sm text-muted-foreground mt-1">
          One-time deep dives, investigations, and diagnostic analyses to answer specific business questions
        </p>
      </div>

      {/* What are Ad Hoc Analyses */}
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <CardTitle className="text-base">What are Ad Hoc Analyses?</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Ad hoc analyses are <strong>targeted investigations</strong> built to answer specific business questions or diagnose issues. Unlike ongoing dashboards that you check regularly, these are created for a specific purpose and timeframe.
          </p>
          <div className="grid md:grid-cols-2 gap-3 mt-4">
            <div className="rounded-lg border border-border p-3 bg-background">
              <div className="font-semibold text-foreground mb-1 text-xs">Dashboards (Regular)</div>
              <div className="text-xs space-y-1">
                <div>• Monitor ongoing metrics</div>
                <div>• Check weekly/daily</div>
                <div>• Evergreen content</div>
                <div>• Example: "Overview Dashboard"</div>
              </div>
            </div>
            <div className="rounded-lg border border-primary/30 p-3 bg-primary/5">
              <div className="font-semibold text-foreground mb-1 text-xs">Ad Hoc Analyses (These)</div>
              <div className="text-xs space-y-1">
                <div>• Answer specific questions</div>
                <div>• One-time investigation</div>
                <div>• Time-bound (e.g., "What happened in Q1?")</div>
                <div>• Example: "Why did conversion drop?"</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Available Analyses */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Available Analyses ({sortedAnalyses.length})</h2>
        
        <div className="grid gap-3">
          {sortedAnalyses.map((analysis) => (
            <Link key={analysis.id} to={`/adhoc/${analysis.id}`}>
              <Card className="hover:border-primary/50 hover:bg-primary/5 transition-all cursor-pointer group">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className="mt-0.5 shrink-0">
                        <BarChart3 className="h-5 w-5 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <CardTitle className="text-base group-hover:text-primary transition-colors">
                          {analysis.name}
                        </CardTitle>
                        {analysis.description && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                            {analysis.description}
                          </p>
                        )}
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all shrink-0" />
                  </div>
                </CardHeader>
                {analysis.dateCreated && (
                  <CardContent className="pt-0">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      <span>Created: {formatDate(analysis.dateCreated)}</span>
                    </div>
                  </CardContent>
                )}
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* How to Add New Analyses */}
      <Card className="border-muted">
        <CardHeader>
          <CardTitle className="text-base">How to Add New Analyses</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-3">
          <div>
            <div className="font-medium text-foreground mb-1">1. Create the Analysis Dashboard</div>
            <p className="text-xs">Build your analysis in <code className="text-xs bg-muted px-1 py-0.5 rounded">client/pages/adhoc/your-analysis-name/</code></p>
          </div>
          
          <div>
            <div className="font-medium text-foreground mb-1">2. Register in Registry</div>
            <p className="text-xs">Add to <code className="text-xs bg-muted px-1 py-0.5 rounded">adHocAnalyses</code> array in <code className="text-xs bg-muted px-1 py-0.5 rounded">client/pages/adhoc/registry.ts</code>:</p>
            <pre className="text-[10px] bg-muted p-2 rounded mt-1 overflow-x-auto">
{`{
  id: "your-analysis-name",
  name: "Your Analysis Title",
  description: "What this analysis investigates",
  dateCreated: "2026-03-11",
  category: 'adhoc'
}`}
            </pre>
          </div>

          <div>
            <div className="font-medium text-foreground mb-1">3. Add Lazy Import</div>
            <p className="text-xs">Add to <code className="text-xs bg-muted px-1 py-0.5 rounded">dashboardComponents</code> map in the same file</p>
          </div>

          <div className="mt-4 p-3 rounded-lg bg-muted/50 border border-border">
            <div className="font-medium text-foreground mb-2 text-xs">Best Practices:</div>
            <ul className="text-xs space-y-1">
              <li>• Include the date range in your analysis (e.g., "Q1 2026 investigation")</li>
              <li>• Add a clear description so others know what question it answers</li>
              <li>• Document assumptions and data sources used</li>
              <li>• Keep analyses focused on one specific question</li>
              <li>• Archive or remove analyses once the issue is resolved</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
