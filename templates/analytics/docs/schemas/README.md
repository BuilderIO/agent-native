# Schema Documentation

This directory contains technical documentation for BigQuery tables and schemas.

## Official Data Dictionary

**Primary Source of Truth**: [Notion Data Dictionary](https://www.notion.so/builderio/31a3d7274be580da9da7cf54909e1b7c?v=31a3d7274be580efb02f000c2d14371e)

The Notion Data Dictionary contains:
- Official metric definitions
- Correct table references
- Supported cuts/filters
- Business context and usage guidelines

**When to use:**
- Creating new dashboards or metrics
- Validating existing queries
- Understanding metric definitions
- Ensuring data consistency

## Local Documentation

This directory provides technical details for developers:

- **[analytics-events-partitioned.md](./analytics-events-partitioned.md)** - App-level events table structure
- **[metrics-events.md](./metrics-events.md)** - Metrics events schema
- **[tracked-events.md](./tracked-events.md)** - Event tracking reference
- **[query-metrics-api.md](./query-metrics-api.md)** - Query API documentation
- **[other-tables.md](./other-tables.md)** - Additional table references

## Workflow

1. **Start with Notion** - Check the Data Dictionary for metric definitions
2. **Reference local docs** - Get technical schema details
3. **Implement queries** - Use correct tables and filters
4. **Document changes** - Update both Notion and local docs as needed
