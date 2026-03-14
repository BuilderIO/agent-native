# How to Add New Ad Hoc Analyses

## What are Ad Hoc Analyses?

Ad hoc analyses are **one-time investigations** built to answer specific business questions or diagnose issues. They differ from regular dashboards:

| Regular Dashboards | Ad Hoc Analyses |
|-------------------|-----------------|
| Ongoing monitoring | One-time investigation |
| Check weekly/daily | Built for specific question |
| Evergreen content | Time-bound (e.g., "Q1 2026 deep dive") |
| Example: "Overview Dashboard" | Example: "Why did conversion drop in March?" |

## When to Create an Ad Hoc Analysis

Create an ad-hoc analysis when:
- ✅ Investigating a specific problem or anomaly
- ✅ Answering a one-time business question
- ✅ Doing a deep dive on a metric that spiked/dropped
- ✅ Post-mortem analysis of an incident
- ✅ Comparing specific time periods (e.g., Q1 vs Q4)
- ✅ Exploratory analysis that may not be needed long-term

Do NOT create an ad-hoc analysis for:
- ❌ Metrics you'll check regularly → Use regular dashboards
- ❌ Permanent KPI tracking → Use regular dashboards
- ❌ General-purpose tools → Use the Tools section

## Step-by-Step Guide

### Step 1: Create Your Analysis Dashboard

Create a new folder and component in `client/pages/adhoc/`:

```
client/pages/adhoc/
  your-analysis-name/
    index.tsx          # Main dashboard component
    queries.ts         # SQL queries (optional, but recommended)
    ComponentA.tsx     # Sub-components as needed
    ComponentB.tsx
```

**Example structure:**
```typescript
// client/pages/adhoc/conversion-analysis/index.tsx
import { useState } from "react";
import { OverallTrendChart } from "./OverallTrendChart";
import { FunnelChart } from "./FunnelChart";

export default function ConversionAnalysisDashboard() {
  const [months, setMonths] = useState(6);
  
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Your Analysis Title
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          What question this analysis answers
        </p>
      </div>

      {/* Controls */}
      <div className="rounded-lg border border-border p-3">
        {/* Date pickers, filters, etc. */}
      </div>

      {/* Charts and tables */}
      <OverallTrendChart months={months} />
      <FunnelChart months={months} />
    </div>
  );
}
```

### Step 2: Add SQL Queries (Recommended Pattern)

Keep your SQL in a separate `queries.ts` file for maintainability:

```typescript
// client/pages/adhoc/your-analysis-name/queries.ts

export function getYourMetricQuery(dateStart: string, dateEnd: string): string {
  return `
    SELECT
      DATE_TRUNC(DATE(created_date), WEEK) AS week,
      COUNT(DISTINCT user_id) AS users,
      COUNT(*) AS events
    FROM \`builder-3b0a2.amplitude.EVENTS_182198\`
    WHERE DATE(event_time) BETWEEN '${dateStart}' AND '${dateEnd}'
      AND event_time <= CURRENT_TIMESTAMP()
    GROUP BY week
    ORDER BY week DESC
  `;
}
```

### Step 3: Register in Registry

Add your analysis to `client/pages/adhoc/registry.ts`:

```typescript
// In registry.ts

export const adHocAnalyses: DashboardMeta[] = [
  {
    id: "your-analysis-name",
    name: "Your Analysis Title",
    description: "Brief description of what this investigates (1-2 sentences)",
    dateCreated: "2026-03-11", // When analysis was created
    category: 'adhoc'
  },
  // ... other analyses
];
```

### Step 4: Add Lazy Import

In the same `registry.ts` file, add to `dashboardComponents`:

```typescript
export const dashboardComponents: Record<
  string,
  React.LazyExoticComponent<ComponentType>
> = {
  // ... existing dashboards
  "your-analysis-name": lazy(() => import("./your-analysis-name")),
};
```

### Step 5: Test

1. Start the dev server: `pnpm dev`
2. Navigate to the sidebar
3. Click "Ad Hoc Analyses" → "View All Analyses"
4. Your analysis should appear in the directory
5. Click it to open

## Best Practices

### Naming Convention

Use kebab-case for IDs and descriptive names:

| ✅ Good | ❌ Bad |
|---------|--------|
| `signup-drop-q1-2026` | `analysis1` |
| `pricing-page-conversion` | `temp-dashboard` |
| `mobile-traffic-investigation` | `test` |

### Documentation

Include in your analysis dashboard:

1. **Title & Description** (at the top)
   ```tsx
   <h1>Traffic to Signup Conversion Analysis</h1>
   <p>Investigation of 20% decline in conversion rate from Feb-Mar 2026</p>
   ```

2. **Date Context** (when analysis is relevant)
   ```tsx
   <p className="text-xs text-muted-foreground">
     Analysis Period: Feb 1 - Mar 10, 2026
   </p>
   ```

3. **Key Findings Section** (what you discovered)
   ```tsx
   <Card>
     <CardHeader>
       <CardTitle>Key Findings</CardTitle>
     </CardHeader>
     <CardContent>
       <ul>
         <li>Signup form completion dropped 18%</li>
         <li>All traffic sources affected equally</li>
         <li>Root cause: New validation field added on Feb 15</li>
       </ul>
     </CardContent>
   </Card>
   ```

4. **Interpretation Guide** (how to read the data)

### When to Archive

Consider archiving an analysis when:
- The issue is resolved
- The data is no longer relevant (>6 months old)
- It's been replaced by a better analysis

**To archive:** Simply remove from `adHocAnalyses` array (or add an `archived: true` flag if you want to keep it accessible).

## Organizing Multiple Analyses

### Chronological (Recommended)

Store analyses in chronological order (newest first). The index page automatically sorts by `dateCreated`.

### By Topic

You can group related analyses using prefixes:
- `conversion-*` - Conversion-related analyses
- `pricing-*` - Pricing experiments and investigations
- `traffic-*` - Traffic source investigations
- `product-*` - Product feature analyses

### Using Subviews

For multi-part analyses, use subviews:

```typescript
{
  id: "q1-revenue-deep-dive",
  name: "Q1 2026 Revenue Deep Dive",
  description: "Comprehensive revenue analysis for Q1",
  dateCreated: "2026-04-01",
  category: 'adhoc',
  subviews: [
    {
      id: "by-product",
      name: "By Product Line",
      params: { "view": "product" }
    },
    {
      id: "by-region",
      name: "By Region",
      params: { "view": "region" }
    }
  ]
}
```

## Template: Quick Analysis

For quick investigations, use this minimal template:

```tsx
// client/pages/adhoc/quick-analysis-name/index.tsx

import { useMetricsQuery } from "@/lib/query-metrics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const SQL_QUERY = `
  SELECT 
    your_column,
    COUNT(*) as count
  FROM \`your-table\`
  WHERE date_column >= CURRENT_DATE() - 30
  GROUP BY your_column
`;

export default function QuickAnalysis() {
  const { data, isLoading } = useMetricsQuery(
    ["quick-analysis"],
    SQL_QUERY
  );

  if (isLoading) return <div>Loading...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Quick Analysis Title</h1>
        <p className="text-sm text-muted-foreground mt-1">
          What you're investigating
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Results</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="text-xs">
            {JSON.stringify(data?.rows, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
```

## Examples from Real Analyses

### Conversion Analysis (Full Featured)
- Multiple visualizations (trend chart, funnel, tables)
- Interactive controls (date ranges, comparison periods)
- Data quality checks
- Interpretation guides
- ~5 sub-components

**Use when:** Complex investigation with multiple dimensions

### Revenue Deep Dive (Medium)
- 2-3 charts
- Basic filtering
- Summary stats
- ~2-3 sub-components

**Use when:** Focused investigation on a specific metric

### Quick Investigation (Minimal)
- Single query
- Simple table or chart
- No sub-components
- All in index.tsx

**Use when:** Quick answer to a specific question

## Pro Tips

1. **Start simple** - Single query in index.tsx, expand later if needed
2. **Reuse components** - Use existing chart/table components from other dashboards
3. **Document assumptions** - Note what you're including/excluding in queries
4. **Add context** - Include "why this was created" in the description
5. **Link related dashboards** - If this analysis led to creating a permanent dashboard, link to it
6. **Version SQL** - Keep the original SQL queries in comments if you iterate

## Sharing Analyses

To share an analysis with others:

1. **Direct link:** Share the URL (e.g., `/adhoc/conversion-analysis`)
2. **Screenshot key findings** and include in Slack/email
3. **Export data:** Use the SQL queries in the queries.ts file for CSV exports
4. **Create summary doc:** Reference the business definitions document

## Transitioning to Permanent Dashboards

If an ad-hoc analysis proves valuable for ongoing monitoring:

1. Create a new regular dashboard in the `dashboards` array
2. Simplify the analysis to focus on key metrics only
3. Remove time-specific context
4. Archive the ad-hoc analysis
5. Add a note in the ad-hoc analysis linking to the new permanent dashboard

**Example:**
```typescript
// In the ad-hoc analysis component
<div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
  <p className="text-sm text-blue-900">
    ℹ️ This analysis led to the creation of the{" "}
    <Link to="/adhoc/conversion-monitoring" className="underline font-medium">
      Conversion Monitoring Dashboard
    </Link>{" "}
    for ongoing tracking.
  </p>
</div>
```
