import { defineAction } from "@agent-native/core";
import { z } from "zod";

const TABLE_INFO = `## BigQuery Tables

| Table | Key Columns |
|---|---|
| dbt_staging_bigquery.first_pageviews | visitor_id, url, referrer, created_date (TIMESTAMP), channel, utm_*, user_id, site_type |
| dbt_staging_bigquery.all_pageviews | page_type, sub_page_type, first_touch_channel, session_channel, c_referrer, utm_* |
| dbt_staging_bigquery.signups | visitor_id, user_id, root_organization_id, utm_*, signup_url, created_date |
| dbt_analytics.product_signups | user_id, user_create_d (TIMESTAMP), channel, icp_flag, top_subscription, referrer, utm_* |
| sigma_materialized.SIGDS_82deb8e2_40f8_4fb4_b3cb_caa011a72d29 | Blog metadata. Columns: SUOHFYGIOG (URL), H5YIATNDT5 (Author), ZZJ6XRJAII (Publish date), FTRKLGZM1R (Purpose), IFHWPU1IDO (Persona), Z52LFY52AK (Topic), _DGCBJNKLE (Sub-type), JQL-G1QE-B (Sub-topic). Has duplicates — deduplicate by slug. |
| dbt_mart.dim_hs_contacts | contact_id, b_visitor_id, builder_user_id, ql_score, company_fit_score, lifecycle_stage_name, date_entered_mql/sal/s0/s1 |
| dbt_mart.dim_deals | deal_id, amount, stage_name (NOT deal_stage), is_closed_won (string), arr_amount, close_date, create_date |
| dbt_mart.dim_subscriptions | subscription_id, root_id, space_id, subscription_arr, start_date, plan, status |

## Join Paths

- Visitor → Signup: first_pageviews.visitor_id = signups.visitor_id
- Visitor → Contact: first_pageviews.visitor_id = dim_hs_contacts.b_visitor_id
- Signup → Contact: signups.user_id = dim_hs_contacts.builder_user_id
- Signup → Subscription: signups.root_organization_id = dim_subscriptions.root_id
- Contact → Deal: use dbt_intermediate.deal_first_contact, or lifecycle stage dates on dim_hs_contacts

## Use @app_events as placeholder for the main events table. Use @project for other fully-qualified tables, for example \`@project.analytics.events_partitioned\`.

## SQL Tips

- first_pageviews.created_date is TIMESTAMP — wrap dates: TIMESTAMP('2025-01-01')
- product_signups.user_create_d is TIMESTAMP
- dim_deals uses stage_name not deal_stage, amount not deal_amount
- Blog metadata table has duplicates — deduplicate with REGEXP_EXTRACT(SUOHFYGIOG, r'/blog/([^/?#]+)') and ROW_NUMBER
`;

export default defineAction({
  description:
    "Print BigQuery table/column mappings, join paths, and SQL patterns. Call this before writing SQL so you know the correct table and column names.",
  schema: z.object({}),
  http: false,
  run: async () => {
    return TABLE_INFO;
  },
});
