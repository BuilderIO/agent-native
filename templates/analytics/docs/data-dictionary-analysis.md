# Data Dictionary Analysis & Recommendations

## Executive Summary

**Current State:**
- 38 total metrics defined
- ✅ **100% complete**: Definition, Table, Department
- ❌ **100% missing**: Owner
- ❌ **95% missing**: Query Template, Common Questions, Known Gotchas, Example Use Case

## Key Issues & Recommendations

### 1. Business Logic vs Metrics (Needs Restructuring)

**Problem:** Two entries are not metrics but reusable business logic:

**Current:**
- `⚙ Root Org ID Resolution (Business Logic)`
- `⚙ Paid Org Filter (Business Logic)`

**Recommendation:** Create a separate section called "**Common Filters & Logic**" and move these there. They're important for SQL queries but shouldn't be listed alongside actual metrics.

---

### 2. Hierarchical Organization Needed

Many metrics are derivatives/calculations of base concepts. We should organize hierarchically:

#### **Example 1: Visitor → Conversion Funnel**

**Base Metrics:**
- Traffic (distinct visitor IDs)
- Signups
- QLs (Qualified Leads)

**Derived Metrics (nest under parent):**
- Signup Rate (Signups ÷ Traffic) → *child of Traffic + Signups*
- QL Rate (QLs ÷ Signups) → *child of QLs + Signups*
- WoW Signups Growth → *child of Signups*

**Recommended Structure:**
```
📊 Traffic
  ├─ Definition: distinct visitor ids
  └─ 📈 Signup Rate (calculated from Traffic + Signups)

📊 Signups
  ├─ Definition: new users created who have a signup date
  ├─ 📈 WoW Signups Growth
  ├─ 📈 Signup Rate
  └─ 📈 Signup to Paid Sub Conversion

📊 QLs (Qualified Leads)
  └─ 📈 QL Rate
```

#### **Example 2: Subscription Metrics**

**Base:**
- Self Serve Paid Subs

**Derived:**
- Signup to Paid Sub Conversion (Paid Subs ÷ Signups) → *child of both*

#### **Example 3: Enterprise Account Health**

**Base Concepts to Define:**
- Pageviews (not currently defined!)
- Spaces (not currently defined!)
- Registered Users (not currently defined!)

**Derived (current metrics):**
- % Pageviews Utilized
- % Spaces Utilized
- % Registered Users Utilized

**Recommendation:** Create parent entries for Pageviews, Spaces, and Registered Users, then nest the % metrics underneath.

---

### 3. Missing Base Definitions

Several "% Utilized" metrics reference concepts that aren't defined:

**Add These Base Metrics:**

1. **Pageviews**
   - Definition: Total number of pages loaded/viewed in a Builder.io space
   - Table: `dbt_mart.enterprise_companies` (contracted_pageviews)
   - Department: Product
   - Child metric: % Pageviews Utilized

2. **Spaces**
   - Definition: Individual Builder.io workspaces within an account (think of them like GitHub repos)
   - Table: `dbt_mart.enterprise_companies` (num_spaces, contracted_spaces)
   - Department: Product
   - Child metric: % Spaces Utilized

3. **Registered Users**
   - Definition: User accounts created within a Builder.io organization
   - Table: `dbt_mart.enterprise_companies` (num_registered_users, contracted_users)
   - Department: Product
   - Child metric: % Registered Users Utilized

---

### 4. Potential Duplicates / Consolidation Opportunities

#### **A. "Pipeline" metrics (3 variations)**

- Pipeline S1 (Qualified)
- Pipeline S2 (Demo)
- Pipeline (generic - includes S1, S2, S3)

**Recommendation:** Create ONE "Pipeline" parent entry, then add a "Cuts" field for stage breakdowns:
```
📊 Pipeline
  Definition: Total deal amount for qualified open deals
  Cuts: 
    - By Stage: S1 (Qualified), S2 (Demo), S3 (Verbal Commit)
    - By Owner
    - By First Pageview Date (acquisition cohort)
```

#### **B. "New Visitors" appears in multiple contexts**

- Standalone metric
- Referenced in Page Performance
- Used in Signup Rate calculation

**Recommendation:** Keep as standalone but add cross-references in other metrics.

---

### 5. Missing Critical Information (95% of metrics)

**Priority 1: Add Query Templates**

Without SQL templates, users can't self-serve. Recommend starting with top 10 most-used metrics:

**High-Priority Metrics for SQL Templates:**
1. Signups (most queried)
2. Traffic
3. QLs
4. Pipeline
5. Current ARR
6. Self Serve Paid Subs
7. Monthly User Count
8. Signup Rate
9. New Visitors
10. % Users with ≥1 Session

**Priority 2: Add Common Questions**

Example for "Signups":
- How many signups came from paid vs organic?
- What's the signup trend week-over-week?
- Which channel drives the most signups?
- How many signups converted to QLs this month?

**Priority 3: Add Known Gotchas**

Example for "Signups":
- ⚠️ Excludes builder.io domain emails (internal users)
- ⚠️ Invited users vs original signups tracked separately
- ⚠️ Date field is `signup_date`, not `created_at`

**Priority 4: Assign Owners**

Every metric needs a DRI (Directly Responsible Individual). Recommendation:
- Marketing metrics → Head of Marketing
- Sales metrics → Head of Sales
- Product metrics → Head of Product
- Customer Success metrics → Head of CS

---

### 6. Specific Metric Recommendations

#### **Signups**
```yaml
Current Definition: ✅ Good
Missing Fields:
  Query Template: |
    SELECT
      date_trunc('day', signup_date) AS signup_day,
      countdistinct(user_id) AS signups
    FROM dbt_mart.dim_users_core
    WHERE signup_date IS NOT NULL
      AND email NOT LIKE '%@builder.io'
    GROUP BY 1
    ORDER BY 1 DESC
  
  Common Questions:
    - How many signups came from organic vs paid channels?
    - What's the week-over-week growth rate?
    - How many invited users vs original signups?
  
  Known Gotchas:
    - Excludes builder.io domain emails (internal team)
    - Use `original_signups` column to exclude invited users
    - Date field is `signup_date`, not `created_at`
  
  Example Use Case:
    Track acquisition funnel performance and identify which marketing channels
    drive the most new user registrations.
```

#### **% Pageviews Utilized**
```yaml
Current: Standalone metric
Recommendation: Nest under "Pageviews" parent

Parent Entry to Create:
  Metric: Pageviews
  Definition: Number of pages loaded/viewed in a Builder.io space during a billing period
  Table: dbt_mart.enterprise_companies
  Department: Product
  
  Common Questions:
    - What's our pageview capacity vs usage?
    - Which accounts are approaching their limits?
    - What's the average pageview consumption per space?

Child Metric (existing):
  Metric: % Pageviews Utilized
  Definition: (num_pageviews / contracted_pageviews) × 100
  Parent: Pageviews
```

#### **Current ARR**
```yaml
Current Definition: ✅ Good
Missing Fields:
  Query Template: |
    SELECT
      account_name,
      current_enterprise_arr AS current_arr
    FROM dbt_mart.enterprise_companies
    WHERE current_enterprise_arr > 0
    ORDER BY current_enterprise_arr DESC
  
  Common Questions:
    - What's the total ARR across all enterprise accounts?
    - Which accounts have the highest ARR?
    - How has ARR trended month-over-month?
  
  Known Gotchas:
    - Only includes enterprise accounts (excludes self-serve)
    - ARR is normalized to annual value (monthly contracts × 12)
    - Field is called `current_enterprise_arr` in the table
  
  Example Use Case:
    Monitor recurring revenue health and identify expansion opportunities
    with high-value accounts.
```

---

### 7. Proposed Taxonomy Structure

```
📁 Customer Acquisition
  📊 Traffic (Base)
    ├─ New Visitors
    └─ Page Performance
  
  📊 Signups (Base)
    ├─ 📈 Signup Rate
    ├─ 📈 WoW Signups Growth
    └─ 📈 Signup to Paid Sub Conversion
  
  📊 QLs - Qualified Leads (Base)
    └─ 📈 QL Rate

📁 Revenue
  📊 Current ARR
  📊 Self Serve Paid Subs
  📊 Pipeline
    ├─ By Stage: S1 (Qualified)
    ├─ By Stage: S2 (Demo)
    └─ By Stage: S3 (Verbal Commit)

📁 Product Usage
  📊 Monthly User Count
  📊 Pageviews (Base) [NEW]
    └─ 📈 % Pageviews Utilized
  
  📊 Spaces (Base) [NEW]
    └─ 📈 % Spaces Utilized
  
  📊 Registered Users (Base) [NEW]
    └─ 📈 % Registered Users Utilized
  
  📊 Sessions
    └─ 📈 % Users with ≥1 Session (Last 30 Days)

📁 Customer Success
  📊 Current ARR
  📊 Usage Metrics
    ├─ % Pageviews Utilized
    ├─ % Spaces Utilized
    └─ % Registered Users Utilized

📁 Common Filters & Logic [NEW SECTION]
  ⚙️ Root Org ID Resolution
  ⚙️ Paid Org Filter
```

---

## Implementation Priorities

### Phase 1: Quick Wins (Week 1)
1. ✅ Move business logic entries to "Common Filters" section
2. ✅ Add 3 missing base metrics (Pageviews, Spaces, Registered Users)
3. ✅ Assign owners to all 38 metrics
4. ✅ Add Common Questions to top 10 metrics

### Phase 2: SQL Templates (Week 2-3)
1. Write query templates for top 10 most-used metrics
2. Add Known Gotchas for top 10
3. Add Example Use Cases for top 10

### Phase 3: Hierarchy (Week 3-4)
1. Reorganize into parent/child taxonomy
2. Add cross-references between related metrics
3. Create "Cuts" field for dimension breakdowns

### Phase 4: Complete Coverage (Ongoing)
1. SQL templates for remaining 28 metrics
2. Common Questions for all metrics
3. Known Gotchas for all metrics
4. Example Use Cases for all metrics

---

## Field Completion Targets

| Field | Current | Target (30 days) | Target (90 days) |
|---|---|---|---|
| Owner | 0% | 100% | 100% |
| Query Template | 5% | 30% | 80% |
| Common Questions | 5% | 30% | 80% |
| Known Gotchas | 5% | 20% | 60% |
| Example Use Case | 5% | 20% | 60% |

---

## Next Steps

1. **Review this analysis** with data team lead
2. **Assign owners** - coordinate with department heads
3. **Prioritize top 10 metrics** for immediate SQL template creation
4. **Launch gamification** to crowdsource contributions
5. **Schedule weekly review** to track completion progress
