# Analytics & Metrics Development Rule

**Trigger**: When working on analytics dashboards, metrics, queries, or data visualization tasks

## Required Steps

1. **Verify metric definitions** match the official documentation
2. **Check table references** to ensure using correct BigQuery tables
3. **Validate cuts/filters** align with documented segmentation
4. **Update dashboard documentation** if adding new metrics

## Metric Naming Conventions

- Use exact metric names from official documentation
- Include proper definitions in UI tooltips/descriptions
- Document any deviations or custom calculations
- Reference the source table in SQL comments

## Query Guidelines

- Always reference the correct table names
- Use documented cuts/filters for segmentation
- Add comments linking to specific metrics
- Validate aggregation logic matches definitions

## When to Update

- Creating new dashboards
- Adding new metrics
- Modifying existing queries
- Validating data accuracy
- Documenting metric changes
