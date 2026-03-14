# Traffic to Signup Conversion Analysis

## Overview

This folder contains a set of SQL queries designed to investigate the decline in traffic-to-signup conversion rates. The queries are organized to help you quickly identify root causes through systematic analysis.

## Quick Start

**Recommended execution order:**

1. **Start with data quality** → `06-data-quality.sql` (5 minutes)
   - Verify tracking is working correctly before analyzing trends
   - If data quality issues are found, the decline might be a measurement problem

2. **Overall trend** → `01-overall-trend.sql` (2 minutes)
   - Identify when the decline started and quantify the magnitude
   - Provides the big picture context

3. **Funnel analysis** → `04-funnel-dropoff.sql` (3 minutes)
   - Pinpoint WHERE in the conversion funnel users are dropping off
   - This often reveals the root cause immediately

4. **Traffic source breakdown** → `02-source-breakdown.sql` (3 minutes)
   - Identify if specific channels are driving the decline
   - Check if traffic mix is shifting

5. **Landing page analysis** → `03-landing-page.sql` (3 minutes)
   - See if conversion varies by entry page
   - Identify if users are entering through lower-converting pages

6. **Cohort comparison** → `05-cohort-comparison.sql` (5 minutes)
   - Deep dive into behavioral changes between cohorts
   - Comprehensive metrics across all dimensions

**Total diagnostic time: ~20 minutes**

## Query Descriptions

### 01-overall-trend.sql

**Purpose:** Calculate weekly conversion rate over the last 6 months

**Output:**

- Unique visitors per week
- Total signups per week
- Conversion rate percentage
- Week-over-week change in conversion rate

**Key insights:**

- When did the decline start?
- Is it gradual or sudden?
- What's the magnitude of the drop?

**How to interpret:**

- Look for negative values in `wow_change_pct` (week-over-week change)
- Compare recent 4 weeks average to previous 4 weeks average
- A consistent negative trend indicates gradual decline vs. sudden drop

---

### 02-source-breakdown.sql

**Purpose:** Compare conversion rates by traffic channel (organic, paid, direct, etc.)

**Output:**

- Conversion rate by channel for recent vs. baseline periods
- Traffic volume changes per channel
- Percentage change in conversion rate

**Key insights:**

- Which channels are declining?
- Is traffic composition shifting (e.g., more low-converting traffic)?
- Are existing channels converting worse, or is it a volume shift?

**How to interpret:**

- Focus on channels with high `recent_visitors` (these impact overall conversion most)
- Negative `conv_rate_change_pct` shows which channels are declining
- `traffic_volume_change_pct` reveals if traffic mix is changing
- A channel with declining conversion AND increasing volume is a red flag

**Common patterns:**

- ❌ High-converting paid traffic declined → budget cuts or campaign changes
- ❌ More blog traffic (low converting) → SEO wins but wrong audience
- ❌ Direct traffic conversion dropped → product/brand perception issue

---

### 03-landing-page.sql

**Purpose:** Analyze conversion by landing page type (homepage, pricing, docs, blog)

**Output:**

- Conversion rate by landing page for recent vs. baseline periods
- Traffic volume changes per landing page
- Share of total traffic per page type

**Key insights:**

- Are users entering through different pages?
- Have specific landing pages degraded in performance?
- Is the traffic mix shifting to lower-converting entry points?

**How to interpret:**

- Check if high-converting pages (pricing, homepage) have declined
- Look at `recent_traffic_share_pct` to see if traffic distribution has shifted
- Declining share for high-converting pages is problematic
- Increasing blog traffic with low conversion suggests content SEO vs. product fit issue

**Common patterns:**

- ❌ Pricing page visits down → awareness issue, fewer qualified visitors
- ❌ More blog entries → content marketing success but wrong audience
- ❌ Homepage conversion dropped → messaging or UX change

---

### 04-funnel-dropoff.sql

**Purpose:** Multi-step funnel from visitor → completed signup to identify WHERE drop-off occurs

**Two versions provided:**

1. **Detailed funnel** (uses Amplitude events):
   - Stage 1: Unique visitors
   - Stage 2: Visited signup/pricing page
   - Stage 3: Submitted signup form
   - Stage 4: Account created
   - Stage 5: Completed signup

2. **Simplified funnel** (if Amplitude data unavailable):
   - Visitors → Visited signup page → Completed signup

**Output:**

- Count at each funnel stage
- Conversion rate at each transition
- Drop-off percentage at each stage
- Comparison between recent vs. baseline periods

**Key insights:**

- WHERE are users dropping off?
- Which stage has the biggest decline in conversion rate?

**How to interpret:**

- If **Stage 2** is down (fewer visiting signup pages):
  - Awareness/interest problem
  - Landing page messaging not driving intent
  - Traffic quality issue (wrong audience)

- If **Stage 3-4** is down (form submission or account creation):
  - Signup form UX issue
  - Technical problems in signup flow
  - Increased friction (new fields, validation errors)

- If **Stage 5** is down (post-signup):
  - Activation or onboarding issue
  - Email verification problems

**Common patterns:**

- ❌ Stage 2 drop → landing page changes, less compelling CTAs
- ❌ Stage 3 drop → signup form too complex, technical errors
- ❌ Consistent drop across all stages → traffic quality issue

---

### 05-cohort-comparison.sql

**Purpose:** Comprehensive comparison of recent cohorts vs. baseline across multiple dimensions

**Two analyses:**

1. **Main cohort comparison:**
   - Traffic source distribution
   - Landing page distribution
   - Engagement metrics (pageviews per session)
   - ICP signup quality
   - Overall conversion rate

2. **Temporal patterns:**
   - Conversion by day of week
   - Identify seasonality or behavioral changes

**Output:**

- Side-by-side comparison of Recent (last 8 weeks) vs. Baseline (weeks 9-16 ago)
- Percentage breakdowns for traffic sources, landing pages
- Average engagement metrics
- ICP signup percentage

**Key insights:**

- Has traffic source mix changed?
- Are users less engaged (fewer pageviews)?
- Has ICP signup quality declined?
- Are there day-of-week patterns?

**How to interpret:**

- Compare `conversion_rate_pct` between cohorts
- Check if high-converting traffic sources have declined in share
- Lower `avg_pageviews_per_session` suggests less engaged visitors
- Declining `icp_signup_pct` might explain revenue impact even if signup volume holds

**Common patterns:**

- ❌ More organic, less paid → cheaper but lower-intent traffic
- ❌ Lower engagement → wrong audience, less product-market fit
- ❌ Lower ICP% → volume looks OK but quality down

---

### 06-data-quality.sql

**Purpose:** Verify tracking is functioning correctly and identify data quality issues

**Five checks:**

1. **Visitor ID & session tracking completeness**
   - NULL percentages for critical fields
   - Flags weeks with high NULL rates

2. **UTM parameter coverage**
   - Attribution data completeness over time
   - Declining coverage suggests data loss

3. **Signup event tracking consistency**
   - Compares `product_signups` table vs. Amplitude events
   - Identifies discrepancies in signup counting

4. **Traffic volume anomalies**
   - Statistical detection of unusual spikes/drops
   - Uses z-score to flag outliers

5. **Visitor → user_id mapping**
   - Verifies signup attribution matching
   - Low match rates mean attribution data loss

**Output:**

- Each check produces a table with quality flags (✓ OK, ⚠️ Warning)
- Percentages for NULL rates, coverage, matching
- Week-by-week trends

**Key insights:**

- Is the decline real or a measurement problem?
- Are we losing attribution data?
- Are there specific weeks with tracking issues?

**How to interpret:**

- ✓ = No issues, data is reliable
- ⚠️ = Data quality problem detected

**If warnings found:**

1. **High NULL rates** → Tracking implementation issue, coordinate with engineering
2. **Low UTM coverage** → Attribution loss, can't trust channel analysis
3. **Signup mismatches** → Event tracking vs. database discrepancy
4. **Traffic anomalies** → Exclude outlier weeks from analysis
5. **Low match rates** → Can't attribute signups to pre-signup behavior

**IMPORTANT:** Run this query FIRST. If data quality issues are found, the conversion decline might be measurement error rather than actual behavioral change.

---

## How to Execute Queries

### Option 1: BigQuery Console (Recommended)

1. Go to [BigQuery Console](https://console.cloud.google.com/bigquery)
2. Select the `builder-3b0a2` project
3. Copy and paste a query from the SQL files
4. Click "Run"
5. Download results as CSV for analysis in Google Sheets/Excel

### Option 2: Command Line (bq CLI)

```bash
bq query --use_legacy_sql=false < 01-overall-trend.sql
```

### Option 3: Create Dashboard (Future)

After identifying the root cause, you can create a permanent dashboard:

- Use queries as a starting point
- Build dashboard in `client/pages/adhoc/conversion-analysis/`
- Register in `client/pages/adhoc/registry.ts`

---

## Interpretation Playbook

### Scenario A: Traffic Quality Issue

**Symptoms:**

- Source breakdown shows shift to low-converting channels
- Landing page analysis shows more blog/docs entries
- Cohort comparison shows lower engagement metrics
- Funnel shows drop at "visited signup page" stage

**Root cause:** Wrong audience reaching the site (content SEO bringing unqualified visitors)

**Actions:**

- Audit SEO/content strategy
- Review keyword targeting
- Check if competitor comparisons or general education content is ranking

---

### Scenario B: Product/UX Change

**Symptoms:**

- Overall trend shows sudden drop at specific week
- Funnel shows drop at "submit form" or "account created" stage
- Landing page conversion dropped uniformly across all pages
- Data quality checks show no tracking issues

**Root cause:** Product change degraded signup flow

**Actions:**

- Review product releases during decline week
- Check for new signup form fields, validation, errors
- A/B test old vs. new signup flow
- Review user session recordings (if available)

---

### Scenario C: Pricing/Positioning Change

**Symptoms:**

- Pricing page conversion dropped significantly
- Funnel shows drop at "visited signup/pricing page"
- Cohort shows more traffic but less engagement
- Direct traffic conversion declined

**Root cause:** Messaging or pricing change deterred signups

**Actions:**

- Review pricing page changes
- Check for new pricing tiers, messaging changes
- Survey users who didn't sign up
- A/B test old vs. new messaging

---

### Scenario D: Data Quality Issue (False Alarm)

**Symptoms:**

- Data quality checks show ⚠️ warnings
- Sudden drop in specific week with recovery
- Tracking NULL rates spiked
- Signup event mismatches

**Root cause:** Tracking implementation bug, not actual decline

**Actions:**

- Coordinate with engineering to fix tracking
- Exclude affected weeks from analysis
- Re-run analysis after tracking is fixed

---

### Scenario E: Channel-Specific Issue

**Symptoms:**

- Source breakdown shows specific channel declined (e.g., paid)
- Other channels stable or improving
- Overall decline proportional to declining channel's share

**Root cause:** Single channel problem (budget cut, campaign pause, algorithm change)

**Actions:**

- Review marketing spend and campaigns
- Check for Google/Facebook algorithm changes
- Audit ad quality scores, landing page relevance
- Increase budget to high-performing campaigns

---

## Next Steps After Analysis

1. **Document findings:**
   - Create a summary of root causes identified
   - Include supporting data from queries
   - Share with stakeholders

2. **Prioritize fixes:**
   - Quick wins (e.g., restore paused campaign)
   - Medium-term (e.g., A/B test signup flow changes)
   - Long-term (e.g., content strategy overhaul)

3. **Create monitoring dashboard:**
   - Once root cause identified, build focused dashboard
   - Monitor key metrics weekly
   - Set up alerts for future declines

4. **Test hypotheses:**
   - A/B test proposed fixes
   - Measure impact with same queries
   - Iterate based on results

---

## Table Schemas Reference

### dbt_staging_bigquery.all_pageviews

- `created_date` (TIMESTAMP) - pageview timestamp
- `visitor_id` (STRING) - unique visitor identifier
- `session_id` (STRING) - session identifier
- `page_type` (STRING) - homepage, pricing, signup, docs, blog
- `first_touch_channel` (STRING) - organic, paid, direct, referral, etc.
- `initial_utm_source/medium/campaign` - attribution parameters

### dbt_analytics.product_signups

- `user_id` (STRING) - unique user identifier
- `user_create_d` (TIMESTAMP) - signup timestamp
- `email` (STRING)
- `channel` (STRING) - signup attribution channel
- `icp_flag` (STRING) - 'ICP' or 'Not ICP'

### amplitude.EVENTS_182198

- `event_type` (STRING) - event name
- `event_time` (TIMESTAMP)
- `user_id` (STRING)
- `event_properties` (JSON)

---

## Common Issues & Troubleshooting

**Query runs too long or times out:**

- Add more restrictive date filters
- Reduce the analysis window (e.g., 3 months instead of 6)
- Run queries during off-peak hours

**Results don't match expected numbers:**

- Check data quality queries first
- Verify date ranges are correct
- Ensure `created_date <= CURRENT_TIMESTAMP()` is included

**Attribution mismatch (visitors vs. signups):**

- visitor_id in pageviews may not match user_id in signups for all users
- Use staging table joins as shown in query patterns
- Some users may sign up without prior pageviews (direct signup links)

**NULL values in key dimensions:**

- Expected for some traffic (direct, no UTM parameters)
- High NULL rates (>10%) indicate tracking issues
- Use data quality queries to investigate

---

## Contact & Support

- **Data issues:** Contact data engineering team
- **Tracking problems:** Contact product/engineering
- **Analysis questions:** Share findings with growth/marketing team

## Version History

- **v1.0** (2024-03-11): Initial query set created
  - 6 diagnostic queries
  - Covers 6-month analysis window
  - Recent vs. baseline comparison framework
