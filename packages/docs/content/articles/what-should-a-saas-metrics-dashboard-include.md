---
slug: what-should-a-saas-metrics-dashboard-include
use_case: startup-kpi-dashboard
job_id: job-kpi-dashboard
title: "What should a SaaS metrics dashboard include?"
meta_description: "A SaaS metrics dashboard should show recurring revenue, whether customers stay, and whether new users become active. The core metrics, and how to build the dashboard."
topic: metrics
apps: [analytics]
audience: technical
published: 2026-10-14
author: "Agent-Native Team"
app_cta_url: "https://analytics.agent-native.com"
cta_label: "Try Analytics"
screenshot_alt: "An Analytics product overview dashboard with metric cards, a weekly active users chart, an activation funnel, and the agent chat open"
cta_band_heading: "Build your first dashboard"
cta_band_subhead: "Connect your data and ask a question."
related_resources:
  - label: "Agent-Native Analytics"
    url: "https://www.agent-native.com/apps/analytics/"
related: []
internal:
  target_terms: "saas metrics dashboard (US 250/mo, KD 3); most important saas metrics (200, KD 19); startup kpi dashboard (150); saas kpi dashboard (150); what does mrr mean (350, KD 9); churn dashboard (140)"
  verify: "Which connectors work reliably today. Metric definitions are standard, but state your own definitions of 'active' in the product."
---

A SaaS metrics dashboard should answer three questions: how much recurring revenue you have and how it's changing, whether customers stay, and whether new people become active users. A handful of metrics covers it. Add more only when someone asks a question the dashboard can't answer.

Most dashboards fail by showing everything. Pick the numbers you'd check every week, and put those on top.

## What should it include?

| Metric                          | What it tells you                                                | Where it usually comes from |
| ------------------------------- | ---------------------------------------------------------------- | --------------------------- |
| MRR (monthly recurring revenue) | The monthly value of your active subscriptions.                  | Your billing system         |
| New, expansion, and churned MRR | Where the change in MRR came from.                               | Your billing system         |
| Customer churn rate             | The share of customers you lost in a period.                     | Your billing system or CRM  |
| Net revenue retention           | Revenue from existing customers now, compared with a period ago. | Your billing system         |
| Activation                      | The share of new signups who reach a key action you define.      | Your product events         |
| Retention                       | The share of a cohort still active after a set number of weeks.  | Your product events         |
| Pipeline                        | Open deals and the stage they're in.                             | Your CRM                    |

## What does MRR mean?

MRR is monthly recurring revenue: the monthly value of your active subscriptions. Annual plans count as one twelfth of their price each month.

## How do you build one with Analytics?

1. Connect a data source. Analytics has connectors for services like Stripe, HubSpot, and BigQuery.
2. Ask for a metric in plain English. The agent turns your question into SQL.
3. Save the panels as a dashboard with filters and saved views.
4. Share it with specific people or your whole organization.

<!-- screenshot -->

<!-- try-it -->

## What should you check before you rely on it?

Agree on one definition of "active" for each product before you chart retention. A chart is only as good as the event behind it. Check your first few numbers against the source you trust most, like your billing system. Analytics works from your data and a data dictionary, so clear column names and definitions help. Analytics is labeled alpha, so expect rough edges.

## Frequently asked questions

### What's a good churn rate?

It depends on your customers and your pricing. Compare against your own history before you compare against other companies.

### What's the difference between churn and retention?

Churn is the share you lost. Retention is the share you kept. They describe the same customers from opposite sides.

### What are the most important SaaS metrics?

Recurring revenue, churn, revenue retention, activation, and retention cover most questions. Add others when a specific question needs them.

### Do I need to write SQL to build a dashboard?

No. In Analytics, you ask in plain English, and the agent turns your question into SQL.

### Is Analytics free?

Analytics is open source and you own the code and the data. It's labeled alpha, so expect rough edges.
