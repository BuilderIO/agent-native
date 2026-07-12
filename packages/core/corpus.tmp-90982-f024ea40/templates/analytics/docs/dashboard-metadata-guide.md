# Dashboard Metadata Guide

All dashboards **MUST** include author and last updated metadata.

## ⚠️ IMPORTANT: Author Must Be Manually Provided

When creating a new dashboard, **YOU (the creator) must provide your name or email** as the author. This is NOT automatically pulled from git logs or other sources. It's a manual requirement for accountability.

### Using the "New Dashboard" Button

When you click the "New Dashboard" button in the sidebar, you'll be prompted to enter:

1. **Your Name or Email** (required) - This becomes the `author` field
2. **Dashboard Description** (required) - What you want the AI to create

The AI will automatically set `author` and `lastUpdated` in the registry based on your input.

## Required Fields

### For All Dashboards

Every dashboard in `app/pages/adhoc/registry.ts` requires:

- **`id`**: Unique kebab-case identifier
- **`name`**: Display name shown in UI
- **`author`**: **YOUR name or email** - the person creating this dashboard (e.g., "jane@example.com" or "Jane Doe")
- **`lastUpdated`**: Last modification date in `YYYY-MM-DD` format (typically today's date when creating)

## Examples

### Dashboard

```typescript
{
  id: "key-metrics",
  name: "Key Metrics",
  author: "jane@example.com",
  lastUpdated: "2026-03-12"
}
```

## Using DashboardHeader Component

Every dashboard component should use the `<DashboardHeader />` component to automatically display metadata:

```typescript
import { DashboardHeader } from "@/components/layout/DashboardHeader";

export default function MyDashboard() {
  return (
    <div className="space-y-6">
      <DashboardHeader
        description="Optional custom description"
        actions={
          // Optional action buttons (filters, exports, etc.)
          <Button>Export</Button>
        }
      />

      {/* Your dashboard content */}
    </div>
  );
}
```

The `DashboardHeader` component will:

- Automatically pull metadata from registry based on the current route
- Display the title, description, author, and last updated date
- Render any action buttons you provide

## Validation

The registry includes automatic validation that runs in development mode. If you're missing required fields, you'll see console errors like:

```
Dashboard 'my-dashboard' (My Dashboard) is missing required metadata:
  - Missing 'author' field
  - Missing 'lastUpdated' field
```

## Updating Metadata

When you modify a dashboard:

1. Update the dashboard code
2. Update the `lastUpdated` field in `registry.ts` to today's date
3. The `DashboardHeader` will automatically show the new date

## Why This Matters

- **Accountability**: Know who created/owns each dashboard
- **Freshness**: See when data was last reviewed/updated
- **Maintenance**: Identify stale dashboards that need updates
- **Documentation**: Provide context for dashboards
