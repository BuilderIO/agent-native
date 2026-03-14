# Data Dictionary - Suggested Content for Top 10 Metrics

## 1. Signups

### Query Template
```sql
-- Basic signup count by day
SELECT
  date_trunc('day', signup_date) AS signup_day,
  count(DISTINCT user_id) AS signups
FROM dbt_mart.dim_users_core
WHERE signup_date IS NOT NULL
  AND email NOT LIKE '%@builder.io'  -- exclude internal
GROUP BY 1
ORDER BY 1 DESC;

-- With channel breakdown
SELECT
  date_trunc('week', s.signup_date) AS signup_week,
  fp.channel,
  count(DISTINCT s.user_id) AS signups
FROM dbt_analytics.signups s
LEFT JOIN dbt_staging_bigquery.first_pageviews fp
  ON s.user_id = fp.user_id
WHERE s.signup_date IS NOT NULL
  AND s.email NOT LIKE '%@builder.io'
GROUP BY 1, 2
ORDER BY 1 DESC, 3 DESC;
```

### Common Questions
- **How many signups came from organic vs paid channels?** Use the channel breakdown query above
- **What's the week-over-week growth rate?** Use WoW Signups Growth metric
- **How many invited users vs original signups?** Filter by `is_original = true` in dim_users_core
- **Which landing pages drive the most signups?** Join with first_pageviews on landing_page_url

### Known Gotchas
- ⚠️ **Excludes builder.io domain emails** - Internal team members are filtered out
- ⚠️ **Invited vs original distinction** - Use `is_original` column to exclude invited users
- ⚠️ **Signup date can be null** - Some old users don't have signup_date, they're excluded
- ⚠️ **Deduplication** - Always use `count(DISTINCT user_id)`, not just `count(*)`

### Example Use Case
"Track weekly signup trends to measure the impact of a new marketing campaign. Compare signup volume before and after campaign launch, broken down by acquisition channel."

### Owner Suggestion
**Head of Marketing** or **Growth Lead**

---

## 2. Traffic

### Query Template
```sql
-- Daily unique visitors
SELECT
  date_trunc('day', pageview_date) AS traffic_day,
  count(DISTINCT visitor_id) AS unique_visitors
FROM dbt_intermediate.all_pageviews
WHERE pageview_date >= current_date - interval '90 days'
GROUP BY 1
ORDER BY 1 DESC;

-- Traffic by channel and page
SELECT
  date_trunc('week', pageview_date) AS week,
  channel,
  page_url,
  count(DISTINCT visitor_id) AS unique_visitors,
  count(*) AS total_pageviews
FROM dbt_intermediate.all_pageviews
WHERE pageview_date >= current_date - interval '30 days'
GROUP BY 1, 2, 3
ORDER BY 4 DESC
LIMIT 50;
```

### Common Questions
- **What's our total traffic this month?** Use the daily query aggregated
- **Which pages get the most traffic?** Group by page_url
- **What percentage of traffic comes from organic search?** Filter by channel = 'organic'
- **How does traffic correlate with signups?** Join with signups on visitor_id → user_id

### Known Gotchas
- ⚠️ **Uses visitor_id, not user_id** - Anonymous visitors are counted
- ⚠️ **Bots and crawlers included** - May need additional filtering
- ⚠️ **Deduplication is critical** - Always count DISTINCT visitor_id
- ⚠️ **First pageview vs all pageviews** - Use first_pageviews table for acquisition analysis

### Example Use Case
"Monitor the impact of SEO improvements by tracking organic search traffic trends week-over-week. Identify which blog posts drive the most qualified traffic."

### Owner Suggestion
**Head of Marketing**

---

## 3. QLs (Qualified Leads)

### Query Template
```sql
-- QLs by cohort week
SELECT
  date_trunc('week', date_moved_from_s0) AS ql_week,
  count(DISTINCT contact_id) AS qualified_leads
FROM dbt_analytics.hs_contacts
WHERE date_moved_from_s0 IS NOT NULL
GROUP BY 1
ORDER BY 1 DESC;

-- QLs by acquisition channel
SELECT
  date_trunc('month', c.date_moved_from_s0) AS ql_month,
  fp.channel,
  count(DISTINCT c.contact_id) AS qualified_leads
FROM dbt_analytics.hs_contacts c
LEFT JOIN dbt_staging_bigquery.first_pageviews fp
  ON c.email = fp.email
WHERE c.date_moved_from_s0 IS NOT NULL
GROUP BY 1, 2
ORDER BY 1 DESC, 3 DESC;
```

### Common Questions
- **How many QLs did we generate this month?** Sum count from monthly query
- **What's our QL conversion rate from signups?** Divide QLs by signups (QL Rate metric)
- **Which channel produces the highest quality leads?** Compare QL rate by channel
- **How long does it take from signup to QL?** Join with signups and calculate datediff

### Known Gotchas
- ⚠️ **Date is when they MOVED from S0** - Not when they entered the system
- ⚠️ **Null values mean never qualified** - Filter these out
- ⚠️ **Can move backwards** - A QL can be disqualified later
- ⚠️ **HubSpot sync delays** - Data may be 24 hours behind real-time

### Example Use Case
"Measure sales team's lead qualification efficiency by tracking the percentage of signups that reach QL status within 30 days, segmented by lead source."

### Owner Suggestion
**Head of Sales** or **Sales Operations**

---

## 4. Pipeline

### Query Template
```sql
-- Total qualified pipeline (S1, S2, S3 stages)
SELECT
  date_trunc('month', d.createdate) AS created_month,
  d.dealstage,
  count(DISTINCT d.dealid) AS num_deals,
  sum(d.amount) AS total_pipeline
FROM dbt_mart.dim_deals d
WHERE d.dealstage IN ('S1 - Qualified', 'S2 - Demo', 'S3 - Verbal Commit')
  AND d.is_closed = false
  AND d.pipeline != 'Self-Serve'
GROUP BY 1, 2
ORDER BY 1 DESC, 4 DESC;

-- Pipeline by owner
SELECT
  o.ownername AS sales_rep,
  count(DISTINCT d.dealid) AS num_deals,
  sum(d.amount) AS total_pipeline,
  avg(d.amount) AS avg_deal_size
FROM dbt_mart.dim_deals d
LEFT JOIN hubspot.owners o ON d.ownerid = o.ownerid
WHERE d.dealstage IN ('S1 - Qualified', 'S2 - Demo', 'S3 - Verbal Commit')
  AND d.is_closed = false
GROUP BY 1
ORDER BY 3 DESC;
```

### Common Questions
- **What's our total pipeline value?** Sum amount across all qualified stages
- **How is pipeline distributed across stages?** Group by dealstage
- **Which rep has the most pipeline?** Group by owner
- **What's the average time in each stage?** Calculate datediff between stage entry dates

### Known Gotchas
- ⚠️ **Excludes S0 (unqualified)** - Pre-qualification deals not counted
- ⚠️ **Excludes closed deals** - Only open pipeline shown
- ⚠️ **Self-Serve pipeline separate** - Different sales motion, tracked separately
- ⚠️ **Amount can be null** - Handle nulls as 0 or exclude

### Example Use Case
"Forecast quarterly revenue by analyzing pipeline coverage. Calculate total pipeline divided by average win rate to predict likely closed-won revenue."

### Owner Suggestion
**Head of Sales**

---

## 5. Current ARR

### Query Template
```sql
-- Total ARR across all enterprise accounts
SELECT
  sum(current_enterprise_arr) AS total_arr,
  count(DISTINCT company_id) AS num_accounts,
  avg(current_enterprise_arr) AS avg_arr_per_account
FROM dbt_mart.enterprise_companies
WHERE current_enterprise_arr > 0;

-- ARR by account tier
SELECT
  CASE
    WHEN current_enterprise_arr < 10000 THEN '<$10K'
    WHEN current_enterprise_arr < 50000 THEN '$10K-$50K'
    WHEN current_enterprise_arr < 100000 THEN '$50K-$100K'
    ELSE '>$100K'
  END AS arr_tier,
  count(DISTINCT company_id) AS num_accounts,
  sum(current_enterprise_arr) AS total_arr
FROM dbt_mart.enterprise_companies
WHERE current_enterprise_arr > 0
GROUP BY 1
ORDER BY 2 DESC;
```

### Common Questions
- **What's our total ARR?** Sum current_enterprise_arr across all accounts
- **Which accounts have the highest ARR?** Order by amount DESC
- **How has ARR trended month-over-month?** Track historical snapshots
- **What percentage of ARR is at risk of churn?** Join with health scores

### Known Gotchas
- ⚠️ **Enterprise-only** - Excludes self-serve subscriptions
- ⚠️ **Normalized to annual** - Monthly contracts multiplied by 12
- ⚠️ **Snapshot data** - Point-in-time value, not historical trend
- ⚠️ **Contract vs actual usage** - ARR is contractual, not usage-based

### Example Use Case
"Calculate net revenue retention by comparing current ARR to ARR from 12 months ago for the same cohort of customers, accounting for expansion, contraction, and churn."

### Owner Suggestion
**Head of Customer Success** or **CFO**

---

## 6. Self Serve Paid Subs

### Query Template
```sql
-- Monthly self-serve subscription count
SELECT
  date_trunc('month', subscription_start_date) AS sub_month,
  count(DISTINCT subscription_id) AS paid_subs,
  sum(mrr) AS total_mrr
FROM dbt_mart.dim_subscriptions
WHERE plan = 'self-serve'
  AND status = 'active'
GROUP BY 1
ORDER BY 1 DESC;

-- Breakdown by plan tier
SELECT
  plan_tier,  -- e.g., 'starter', 'pro', 'growth'
  count(DISTINCT subscription_id) AS num_subs,
  sum(mrr) AS total_mrr,
  avg(mrr) AS avg_mrr
FROM dbt_mart.dim_subscriptions
WHERE plan = 'self-serve'
  AND status = 'active'
GROUP BY 1
ORDER BY 2 DESC;
```

### Common Questions
- **How many active paid self-serve subs do we have?** Count where status = 'active'
- **What's the conversion rate from free to paid?** Divide paid subs by total signups
- **Which plan tier is most popular?** Group by plan_tier
- **What's the average MRR per subscription?** Sum MRR / count subs

### Known Gotchas
- ⚠️ **Stripe data source** - Synced from Stripe, may have delay
- ⚠️ **Active vs all subscriptions** - Filter by status = 'active'
- ⚠️ **Plan = 'self-serve'** - Excludes enterprise contracts
- ⚠️ **Cancellations included if active** - Check `cancelled_at` for churn

### Example Use Case
"Track product-led growth by monitoring the self-serve paid subscription acquisition rate and comparing it to free trial starts, identifying conversion bottlenecks."

### Owner Suggestion
**Head of Product** or **Growth Lead**

---

## 7. Monthly User Count

### Query Template
```sql
-- User count trend for a specific account
SELECT
  date_trunc('month', snapshot_date) AS month,
  count(DISTINCT user_id) AS total_users
FROM dbt_mart.dim_users_core u
LEFT JOIN dbt_mart.dim_root_organizations ro
  ON u.root_org_id = ro.root_org_id
WHERE ro.account_name = 'Acme Corp'  -- replace with account name
  AND snapshot_date = last_day(snapshot_date)  -- end of month
GROUP BY 1
ORDER BY 1;

-- User growth across all paid accounts
SELECT
  date_trunc('month', snapshot_date) AS month,
  count(DISTINCT u.user_id) AS total_users,
  count(DISTINCT u.root_org_id) AS num_accounts,
  avg(users_per_account) AS avg_users_per_account
FROM dbt_mart.dim_users_core u
LEFT JOIN dbt_mart.dim_root_organizations ro
  ON u.root_org_id = ro.root_org_id
WHERE ro.subscription_name NOT IN ('free', 'internal')
  AND snapshot_date = last_day(snapshot_date)
GROUP BY 1
ORDER BY 1;
```

### Common Questions
- **How many users does account X have?** Filter by account name
- **Is user count growing or declining?** Compare month-over-month
- **Which accounts have the fastest user growth?** Calculate % change MoM
- **What's the average user count per account?** Group by account, average

### Known Gotchas
- ⚠️ **Snapshot on last day of month** - Only counts users as of month-end
- ⚠️ **Includes inactive users** - Filter by last_login if needed
- ⚠️ **Invited users counted** - No distinction between invited and original
- ⚠️ **Root org level** - Users are rolled up to parent organization

### Example Use Case
"Monitor customer expansion by tracking monthly user count growth for enterprise accounts, identifying which customers are scaling up usage and may need capacity upgrades."

### Owner Suggestion
**Head of Customer Success**

---

## 8. Signup Rate

### Query Template
```sql
-- Overall signup rate by week
SELECT
  date_trunc('week', fp.pageview_date) AS week,
  count(DISTINCT fp.visitor_id) AS new_visitors,
  count(DISTINCT s.user_id) AS signups,
  round(count(DISTINCT s.user_id)::numeric / nullif(count(DISTINCT fp.visitor_id), 0), 4) AS signup_rate
FROM dbt_staging_bigquery.first_pageviews fp
LEFT JOIN dbt_staging_bigquery.signups s
  ON fp.visitor_id = s.visitor_id
  AND s.signup_date >= fp.pageview_date
  AND s.signup_date <= fp.pageview_date + interval '30 days'  -- 30-day attribution window
GROUP BY 1
ORDER BY 1 DESC;

-- Signup rate by channel
SELECT
  fp.channel,
  count(DISTINCT fp.visitor_id) AS new_visitors,
  count(DISTINCT s.user_id) AS signups,
  round(count(DISTINCT s.user_id)::numeric / nullif(count(DISTINCT fp.visitor_id), 0), 4) AS signup_rate
FROM dbt_staging_bigquery.first_pageviews fp
LEFT JOIN dbt_staging_bigquery.signups s
  ON fp.visitor_id = s.visitor_id
  AND s.signup_date >= fp.pageview_date
  AND s.signup_date <= fp.pageview_date + interval '30 days'
WHERE fp.pageview_date >= current_date - interval '90 days'
GROUP BY 1
ORDER BY 4 DESC;
```

### Common Questions
- **What's our current signup conversion rate?** Calculate signups / new visitors
- **Which channel has the best signup rate?** Group by channel and compare
- **Has signup rate improved after UX changes?** Compare before/after periods
- **What's the typical time-to-signup?** Calculate datediff(signup_date, first_pageview_date)

### Known Gotchas
- ⚠️ **Attribution window matters** - Use 30-day window for most cases
- ⚠️ **Visitor ID matching** - Some visitors may not match due to cookies/tracking
- ⚠️ **Exclude internal traffic** - Filter out builder.io domain
- ⚠️ **New visitors only** - Uses first_pageviews, not all pageviews

### Example Use Case
"Optimize landing page conversion by A/B testing different headlines and CTAs, measuring impact on signup rate for organic search traffic specifically."

### Owner Suggestion
**Head of Marketing** or **Growth Lead**

---

## 9. New Visitors

### Query Template
```sql
-- New visitors by day
SELECT
  date_trunc('day', pageview_date) AS visitor_day,
  count(DISTINCT visitor_id) AS new_visitors,
  count(DISTINCT CASE WHEN channel = 'organic' THEN visitor_id END) AS organic,
  count(DISTINCT CASE WHEN channel = 'paid' THEN visitor_id END) AS paid,
  count(DISTINCT CASE WHEN channel = 'direct' THEN visitor_id END) AS direct
FROM dbt_staging_bigquery.first_pageviews
WHERE pageview_date >= current_date - interval '90 days'
GROUP BY 1
ORDER BY 1 DESC;

-- New visitors by landing page
SELECT
  landing_page_url,
  count(DISTINCT visitor_id) AS new_visitors,
  round(avg(time_on_page_seconds)) AS avg_time_on_page
FROM dbt_staging_bigquery.first_pageviews
WHERE pageview_date >= current_date - interval '30 days'
GROUP BY 1
ORDER BY 2 DESC
LIMIT 50;
```

### Common Questions
- **How many new visitors do we get per day?** Sum from daily query
- **What percentage come from organic search?** Organic / total
- **Which landing pages attract the most new visitors?** Group by landing_page_url
- **How does new visitor count correlate with signups?** Join with signups

### Known Gotchas
- ⚠️ **First pageview only** - Each visitor counted once, at first visit
- ⚠️ **Cookie-based tracking** - Clearing cookies creates "new" visitor
- ⚠️ **Channel attribution** - Uses last-click attribution model
- ⚠️ **Bot traffic may be included** - Consider additional filtering

### Example Use Case
"Measure the effectiveness of content marketing by tracking new visitor acquisition from blog posts, comparing SEO performance across different content topics."

### Owner Suggestion
**Head of Marketing**

---

## 10. % Users with ≥1 Session (Last 30 Days)

### Query Template
```sql
-- Session engagement rate for all paid accounts
SELECT
  ro.account_name,
  count(DISTINCT u.user_id) AS total_users,
  count(DISTINCT CASE 
    WHEN us.session_raw_date >= current_date - interval '30 days' 
    THEN us.user_id 
  END) AS active_users,
  round(
    count(DISTINCT CASE WHEN us.session_raw_date >= current_date - interval '30 days' THEN us.user_id END)::numeric
    / nullif(count(DISTINCT u.user_id), 0),
    4
  ) AS pct_active
FROM dbt_mart.dim_users_core u
LEFT JOIN dbt_mart.dim_root_organizations ro
  ON u.root_org_id = ro.root_org_id
LEFT JOIN dbt_mart.user_sessions us
  ON u.user_id = us.user_id
WHERE ro.subscription_name NOT IN ('free', 'internal')
GROUP BY 1
ORDER BY 4 DESC;

-- Trending engagement over time
SELECT
  date_trunc('week', us.session_raw_date) AS week,
  count(DISTINCT u.user_id) AS total_users,
  count(DISTINCT us.user_id) AS active_users,
  round(count(DISTINCT us.user_id)::numeric / nullif(count(DISTINCT u.user_id), 0), 4) AS pct_active
FROM dbt_mart.dim_users_core u
LEFT JOIN dbt_mart.user_sessions us
  ON u.user_id = us.user_id
  AND us.session_raw_date >= u.created_at
  AND us.session_raw_date >= current_date - interval '90 days'
WHERE u.root_org_id IN (SELECT root_org_id FROM dbt_mart.dim_root_organizations WHERE subscription_name NOT IN ('free', 'internal'))
GROUP BY 1
ORDER BY 1 DESC;
```

### Common Questions
- **Which accounts have low engagement?** Filter for pct_active < 20%
- **Is engagement improving over time?** Compare month-over-month
- **What's the average engagement across all accounts?** Average pct_active
- **How does engagement correlate with churn?** Join with churn events

### Known Gotchas
- ⚠️ **30-day rolling window** - Dynamic window, updates daily
- ⚠️ **Session definition varies** - Confirm what constitutes a "session"
- ⚠️ **Includes all users** - Active and inactive accounts counted
- ⚠️ **Denominator is total users** - Not just users who could have sessions

### Example Use Case
"Identify at-risk enterprise accounts by monitoring the percentage of users with recent sessions. Accounts with <20% active users may need intervention to prevent churn."

### Owner Suggestion
**Head of Customer Success** or **Head of Product**

---

## Summary: Quick Owner Assignment Guide

| Metric | Suggested Owner |
|--------|----------------|
| Signups | Head of Marketing |
| Traffic | Head of Marketing |
| QLs | Head of Sales |
| Pipeline | Head of Sales |
| Current ARR | Head of Customer Success |
| Self Serve Paid Subs | Head of Product |
| Monthly User Count | Head of Customer Success |
| Signup Rate | Head of Marketing |
| New Visitors | Head of Marketing |
| % Users with ≥1 Session | Head of Customer Success |

---

## Next Action: Copy these suggestions into Notion

1. Open each metric page in Notion
2. Paste the Query Template into the "Query Template" field
3. Add each Common Question as a bullet point
4. Add each Known Gotcha with the ⚠️ emoji
5. Paste the Example Use Case
6. Assign the suggested owner

This will bring your top 10 metrics from 0% → 100% completion! 🎉
