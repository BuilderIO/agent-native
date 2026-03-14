# Analytics & Metrics Development Rule

**Trigger**: When working on analytics dashboards, metrics, queries, or data visualization tasks

## Data Dictionary Reference

Before starting any analytics or metrics work, ALWAYS fetch and reference the official Data Dictionary:

**Notion URL**: https://www.notion.so/builderio/31a3d7274be580da9da7cf54909e1b7c?v=31a3d7274be580efb02f000c2d14371e

Use the `mcp__notion__notion-fetch` tool to retrieve current metric definitions.

## Required Steps

1. **Fetch Data Dictionary** at the start of any analytics task
2. **Verify metric definitions** match the official documentation
3. **Check table references** to ensure using correct BigQuery tables
4. **Validate cuts/filters** align with documented segmentation
5. **Update dashboard documentation** if adding new metrics

## Metric Naming Conventions

- Use exact metric names from the Data Dictionary
- Include proper definitions in UI tooltips/descriptions
- Document any deviations or custom calculations
- Reference the source table in SQL comments

## Query Guidelines

- Always reference the Data Dictionary for correct table names
- Use documented cuts/filters for segmentation
- Add comments linking to specific metrics in the dictionary
- Validate aggregation logic matches definitions

## Example Workflow

```typescript
// Before creating a new metric query:
// 1. Fetch from Notion: mcp__notion__notion-fetch
// 2. Find metric definition in Data Dictionary
// 3. Use specified table and cuts
// 4. Add reference comment:

// Metric: "Daily Active Users"
// Definition: [from Data Dictionary]
// Table: dbt_analytics.user_activity
// Cuts: exclude internal, by date
```

## When to Update

- Creating new dashboards
- Adding new metrics
- Modifying existing queries
- Validating data accuracy
- Documenting metric changes
