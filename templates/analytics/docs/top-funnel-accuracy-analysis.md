# Top Funnel Acquisition Accuracy Analysis

## Data Dictionary Metrics vs Current Implementation

### 1. **Traffic** ❌ MISSING

**Data Dictionary Definition:**

- **Metric:** Traffic
- **Definition:** "distinct visitor ids"
- **Table:** `dbt_intermediate.all_pageviews`
- **Status:** Not currently implemented as a standalone metric

**Recommendation:** Add a distinct "Traffic" metric that counts all distinct visitors (not just first-time)

---

### 2. **New Visitors** ⚠️ PARTIALLY INCORRECT

**Data Dictionary Definition:**

- **Metric:** New Visitors
- **Definition:** "Count of distinct first-time visitors (by User_Id) cohorted by their first pageview date. Only counts users whose first-ever pageview falls within the selected date range."
- **Table:** `sigma_materialized.t_mat_ab7b70cf, dbt_analytics.hs_contacts, dbt_mart.user_top_subscription`

**Current Implementation:**

```sql
-- queries.ts:157-169
FROM ${FIRST_PV} v  -- dbt_staging_bigquery.first_pageviews
LEFT JOIN ${SIGNUPS} s ON v.visitor_id = s.visitor_id
WHERE ${where}
GROUP BY flex_date, flex_view_by
```

**Issues:**

1. ❌ Using `dbt_staging_bigquery.first_pageviews` instead of recommended sigma materialized view
2. ⚠️ The current query relies on `first_pageviews` table which should contain first pageviews, but not confirmed to match Data Dictionary's logic
3. ❌ Missing joins to `dbt_analytics.hs_contacts` and `dbt_mart.user_top_subscription` as specified

**Recommendation:** Update to use sigma materialized view `t_mat_ab7b70cf` or verify that `first_pageviews` implements the exact same logic

---

### 3. **Signups** ⚠️ PARTIALLY INCORRECT

**Data Dictionary Definition:**

- **Metric:** Signups
- **Definition:** "Count of distinct users who created an account, cohorted by User_Create_D. Pageview Centric view excludes signups without a tracked pageview (e.g. adblock/Figma plugin). Signup Centric view includes ALL product signups."
- **Table:** `sigma_materialized.t_mat_abfab3f3, dbt_analytics.hs_contacts, dbt_mart.user_top_subscription`

**Current Implementation:**

**Tab 1 (First Touch Traffic) - Pageview Centric:**

```sql
-- queries.ts:157-169
LEFT JOIN ${SIGNUPS} s ON v.visitor_id = s.visitor_id  -- dbt_staging_bigquery.signups
```

**Tab 2 (Signups by Channel) - Signup Centric:**

```sql
-- queries.ts:512-536
FROM ${PRODUCT_SIGNUPS} ps  -- dbt_analytics.product_signups
```

**Issues:**

1. ❌ Tab 1 uses `dbt_staging_bigquery.signups` instead of sigma materialized view `t_mat_abfab3f3`
2. ✅ Tab 2 correctly uses `dbt_analytics.product_signups` for signup-centric view
3. ❌ Missing joins to `dbt_analytics.hs_contacts` and `dbt_mart.user_top_subscription` in both tabs

**Recommendation:**

- Tab 1: Switch to sigma materialized view for consistency
- Both tabs: Add joins to contacts and subscriptions tables per Data Dictionary spec

---

### 4. **First Touch Channel** ⚠️ IMPLEMENTATION MISMATCH

**Data Dictionary Definition:**

- **Metric:** First Touch Channel
- **Definition:** "Attributed acquisition channel based on a user's first tracked touchpoint. Coalesce_Channel prioritizes First_Touch_Channel over the pageview-level Channel field. Values: direct, organic, figma, oss, ai chat, paid, referral, social, other."
- **Table:** `signup materialized views`

**Current Implementation:**

```sql
-- queries.ts:123-124 (viewByToExpr)
case "Channel":
  return useAllPv ? `${prefix}.first_touch_channel` : `${prefix}.channel`;
```

**Issues:**

1. ⚠️ Using `channel` field from first_pageviews instead of coalesced channel logic
2. ❌ Should prioritize `First_Touch_Channel` over pageview-level `Channel`
3. ❌ Not using signup materialized views as specified

**Recommendation:** Implement Coalesce_Channel logic that prioritizes First_Touch_Channel

---

### 5. **Signup to Paid Sub Conversion** ⚠️ CALCULATION DIFFERS

**Data Dictionary Definition:**

- **Metric:** Signup to Paid Sub Conversion
- **Definition:** "Percentage of signups that convert to at least one paid subscription. Calculated as Paid Subscribers ÷ Total Signups."
- **Table:** `signup materialized views, dbt_mart.user_top_subscription`

**Current Implementation:**

```sql
-- queries.ts:522-527
SAFE_DIVIDE(
  COUNT(DISTINCT CASE WHEN ps.top_subscription IS NOT NULL AND ps.top_subscription != '' THEN ps.user_id END),
  COUNT(DISTINCT ps.user_id)
) AS signup_to_paid_conversion
```

**Issues:**

1. ⚠️ Logic checks `top_subscription IS NOT NULL AND != ''` which may not match "at least one paid subscription"
2. ❌ Not using `dbt_mart.user_top_subscription` table as specified
3. ⚠️ Should explicitly count "paid" subscriptions, not just any subscription

**Recommendation:** Join to `dbt_mart.user_top_subscription` and filter for paid subscriptions only

---

## Summary of Required Changes

### High Priority (Accuracy Issues)

1. ✅ **Add Traffic metric** - Count distinct visitors from all_pageviews
2. ⚠️ **Verify New Visitors logic** - Confirm first_pageviews matches sigma materialized view or switch to recommended table
3. ⚠️ **Update Signups source** - Use sigma materialized view `t_mat_abfab3f3` for Tab 1 (pageview-centric)
4. ⚠️ **Implement Coalesce_Channel** - Prioritize First_Touch_Channel over Channel field
5. ⚠️ **Fix Signup to Paid Sub Conversion** - Use user_top_subscription table and filter for paid subs

### Medium Priority (Completeness)

6. ❌ **Add missing joins** - Include hs_contacts and user_top_subscription joins per Data Dictionary specs
7. ❌ **Standardize table references** - Ensure all metrics use Data Dictionary specified tables

### Recommended Tables

- **New Visitors:** `sigma_materialized.t_mat_ab7b70cf` (or verify first_pageviews matches)
- **Signups (Pageview-centric):** `sigma_materialized.t_mat_abfab3f3`
- **Signups (Signup-centric):** ✅ `dbt_analytics.product_signups` (already correct)
- **Contacts:** `dbt_analytics.hs_contacts`
- **Subscriptions:** `dbt_mart.user_top_subscription`
- **Traffic:** `dbt_intermediate.all_pageviews`
