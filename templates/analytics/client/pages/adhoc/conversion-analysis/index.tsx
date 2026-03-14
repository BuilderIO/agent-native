import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, TrendingDown, Target } from "lucide-react";
import { DashboardHeader } from "@/components/layout/DashboardHeader";

export default function ConversionAnalysisDashboard() {
  return (
    <div className="space-y-6">
      <DashboardHeader description="Diagnostic guide for identifying the root cause of conversion decline" />

      {/* Diagnostic Walkthrough Guide */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            🔍 How to Identify a Signup Form Issue
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Let me walk you through the diagnostic logic for identifying a{" "}
            <strong>Signup Form Issue</strong> using the dashboard you're
            looking at right now.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Step-by-Step Process Header */}
          <div>
            <h3 className="font-semibold text-base mb-4">
              Step-by-Step Diagnostic Process
            </h3>
          </div>

          {/* Step 1 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 font-semibold">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <span>Step 1: Check Data Quality First</span>
            </div>
            <div className="ml-7 space-y-2 text-sm">
              <p>
                Look at the <strong>Data Quality Check</strong> section (top of
                dashboard):
              </p>
              <div className="bg-background/50 rounded p-3 space-y-1">
                <div className="font-medium">What you're looking for:</div>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li>✅ All weeks show "OK" status</li>
                  <li>✅ NULL rates are &lt;5%</li>
                </ul>
              </div>
              <p className="text-muted-foreground italic">
                <strong>Why this matters:</strong> If data quality is bad, you
                can't trust any analysis. This confirms the decline is real, not
                a tracking bug.
              </p>
            </div>
          </div>

          {/* Step 2 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 font-semibold">
              <TrendingDown className="h-5 w-5 text-blue-600" />
              <span>Step 2: Confirm Overall Decline</span>
            </div>
            <div className="ml-7 space-y-2 text-sm">
              <p>
                Look at the <strong>Overall Conversion Trend</strong> chart:
              </p>
              <div className="bg-background/50 rounded p-3 space-y-1">
                <div className="font-medium">What you'd see:</div>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li>
                    Recent 4 Weeks Avg: <strong>2.8%</strong>
                  </li>
                  <li>
                    Baseline 4 Weeks Avg: <strong>3.5%</strong>
                  </li>
                  <li>
                    Change: <strong className="text-destructive">-0.7%</strong>{" "}
                    (-20% decline)
                  </li>
                </ul>
              </div>
              <p className="text-muted-foreground italic">
                <strong>What this tells you:</strong> Yes, conversion is
                definitely declining. Now we need to find WHERE in the funnel.
              </p>
            </div>
          </div>

          {/* Step 3 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 font-semibold">
              <Target className="h-5 w-5 text-orange-600" />
              <span>Step 3: Find the Drop-off Point</span>
            </div>
            <div className="ml-7 space-y-2 text-sm">
              <p>
                Look at the <strong>Conversion Funnel Analysis</strong>{" "}
                (side-by-side comparison):
              </p>
              <div className="bg-background/50 rounded p-3">
                <div className="font-medium mb-2">
                  Here's what a SIGNUP FORM ISSUE looks like:
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2">Stage</th>
                        <th className="text-center py-2">Recent</th>
                        <th className="text-center py-2">Baseline</th>
                        <th className="text-right py-2">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-border/50">
                        <td className="py-2">Total Visitors</td>
                        <td className="text-center">50,000</td>
                        <td className="text-center">48,000</td>
                        <td className="text-right text-green-600">+4% ✅</td>
                      </tr>
                      <tr className="border-b border-border/50">
                        <td className="py-2">Visited Intent Page</td>
                        <td className="text-center">12,500 (25%)</td>
                        <td className="text-center">12,000 (25%)</td>
                        <td className="text-right text-green-600">Stable ✅</td>
                      </tr>
                      <tr className="border-b border-border/50">
                        <td className="py-2">Visited Signup Page</td>
                        <td className="text-center">7,500 (15%)</td>
                        <td className="text-center">7,200 (15%)</td>
                        <td className="text-right text-green-600">Stable ✅</td>
                      </tr>
                      <tr>
                        <td className="py-2 font-semibold">Completed Signup</td>
                        <td className="text-center font-semibold">
                          1,400 (2.8%)
                        </td>
                        <td className="text-center font-semibold">
                          1,680 (3.5%)
                        </td>
                        <td className="text-right text-destructive font-semibold">
                          -17% 🚨
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 rounded p-3 mt-3">
                <div className="font-semibold text-orange-900 dark:text-orange-200 mb-2">
                  🎯 The Problem:
                </div>
                <ul className="list-disc list-inside space-y-1 text-orange-800 dark:text-orange-300 text-sm">
                  <li>Traffic is UP (+4%)</li>
                  <li>Intent page visits are STABLE</li>
                  <li>Signup page visits are STABLE</li>
                  <li>
                    <strong>But signup completion DROPPED -17%</strong>
                  </li>
                </ul>
                <p className="mt-3 font-semibold text-orange-900 dark:text-orange-200">
                  → This means users WANT to sign up (they're reaching the form)
                  but something is PREVENTING completion.
                </p>
              </div>
            </div>
          </div>

          {/* Possible Causes */}
          <div className="mt-6 pt-6 border-t border-border">
            <div className="font-semibold mb-3">
              Possible Causes of Signup Form Issue:
            </div>
            <ul className="grid md:grid-cols-2 gap-2 text-sm">
              <li className="flex items-start gap-2">
                <span>•</span>
                <span>New required fields added to form</span>
              </li>
              <li className="flex items-start gap-2">
                <span>•</span>
                <span>Form validation became stricter</span>
              </li>
              <li className="flex items-start gap-2">
                <span>•</span>
                <span>Technical bugs (JS errors, API failures)</span>
              </li>
              <li className="flex items-start gap-2">
                <span>•</span>
                <span>Form became slower / timeout issues</span>
              </li>
              <li className="flex items-start gap-2">
                <span>•</span>
                <span>CAPTCHA or verification added</span>
              </li>
              <li className="flex items-start gap-2">
                <span>•</span>
                <span>Email verification requirements changed</span>
              </li>
            </ul>
          </div>

          {/* Business Impact */}
          <div className="bg-destructive/10 border border-destructive/20 rounded p-4">
            <div className="font-semibold text-destructive mb-2">
              Business Impact:
            </div>
            <p className="text-sm text-destructive/90">
              You're losing{" "}
              <strong>ready-to-buy customers at the finish line</strong>. They
              want your product (proven by reaching the signup page), but the
              form is blocking them. This is the most expensive type of
              conversion loss because the hardest part (getting them interested)
              is already done.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
