# Analytics

An open-source, agent-native alternative to Amplitude, Mixpanel, and Looker. Ask
analytics questions in plain English and get charts, dashboards, and re-runnable
investigations back — you own the code, the queries, and the data.

**Live app: [analytics.agent-native.com](https://analytics.agent-native.com)**

The agent connects to your data, writes and validates the SQL for you, and
renders the answer as a chart, table, metric, or saved dashboard panel. Anything
you can do in the UI, the agent can do through the same actions.

## Features

- Ask data questions in plain English and get charts, tables, or metrics back.
- Connect BigQuery, GA4, Mixpanel, Amplitude, PostHog, HubSpot, Jira, and more,
  plus a built-in first-party event collector.
- Build reusable SQL dashboards with filters, saved views, and parametric queries.
- Save ad-hoc analyses as re-runnable investigations with question, instructions,
  and findings.
- Maintain a living data dictionary so the agent uses real warehouse column names.
- Share dashboards per-user or per-org with viewer / editor / admin roles.

## Develop locally

Scaffold your own copy and run it:

```bash
npx @agent-native/core@latest create my-analytics --standalone --template analytics
cd my-analytics
pnpm install
pnpm dev
```

Full docs: [agent-native.com/docs/template-analytics](https://agent-native.com/docs/template-analytics).
