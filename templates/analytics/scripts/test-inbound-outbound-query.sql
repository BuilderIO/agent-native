-- Test query for Inbound/Outbound deal classification
-- This validates the logic before creating the dbt model
--
-- Qualifying forms include:
-- - Forms with "Sales" in name or conversion_details
-- - Forms with "demo" anywhere (case-insensitive)
-- - "[Marketing]  | Component Indexing Request"
-- - Forms with "Unlock Ent Trial" in conversion_details

WITH

    qualifying_forms AS (
        SELECT
            form_id,
            form_name,
            form_fill_date,
            email,
            b_visitor_id,
            conversion_details,
            form_type,
            form_intent
        FROM `builder-3b0a2.dbt_intermediate.hubspot_form_submissions`
        WHERE
            form_name IS NOT NULL
            AND (
                -- Forms with "Sales" in name or conversion_details
                LOWER(form_name) LIKE '%sales%'
                OR LOWER(conversion_details) LIKE '%sales%'
                -- Forms with "demo" anywhere
                OR LOWER(form_name) LIKE '%demo%'
                OR LOWER(conversion_details) LIKE '%demo%'
                -- Component Indexing Request
                OR form_name = '[Marketing]  | Component Indexing Request'
                -- Unlock Ent Trial
                OR conversion_details = 'Unlock Ent Trial'
            )
    ),

    deal_contact_forms AS (
        SELECT
            d.deal_id,
            d.deal_name,
            d.createdate AS deal_create_date,
            d.close_date,
            d.amount,
            d.stage_name,
            d.pipeline_name,
            d.enterprise_lead_source,
            d.is_closed_won,
            dc.contact_id,
            c.email AS contact_email,
            c.b_visitor_id AS contact_visitor_id,
            c.builder_user_id AS contact_user_id,
            ps.user_create_d AS signup_date,
            qf.form_name,
            qf.form_fill_date,
            qf.conversion_details
        FROM `builder-3b0a2.dbt_mart.dim_hs_deals` d
        -- Join to get all contacts associated with the deal
        LEFT JOIN
            `builder-3b0a2.dbt_mapping.hs_deals_to_contact_id` dc ON d.deal_id = dc.deal_id
        -- Join to get contact details for matching to forms and signups
        LEFT JOIN
            `builder-3b0a2.dbt_mart.dim_hs_contacts` c ON dc.contact_id = c.contact_id
        -- Join to qualifying forms (match by email OR visitor ID)
        -- AND form was filled BEFORE deal creation
        LEFT JOIN
            qualifying_forms qf
            ON (
                LOWER(qf.email) = LOWER(c.email)
                OR (
                    qf.b_visitor_id IS NOT NULL
                    AND qf.b_visitor_id = c.b_visitor_id
                )
            )
            AND qf.form_fill_date < d.createdate
        -- Join to product signups (match by email OR user_id)
        -- AND signup was BEFORE deal creation
        LEFT JOIN
            `builder-3b0a2.dbt_analytics.product_signups` ps
            ON (
                LOWER(ps.email) = LOWER(c.email)
                OR (
                    ps.user_id IS NOT NULL
                    AND ps.user_id = c.builder_user_id
                )
            )
            AND ps.user_create_d < d.createdate
        WHERE
            -- Filter to Enterprise pipelines only
            d.pipeline_name IN ('Enterprise: New Business', 'Enterprise: White Label')
    ),

    deal_form_aggregates AS (
        SELECT
            deal_id,
            COUNT(DISTINCT form_name) AS qualifying_form_count,
            MIN(form_fill_date) AS first_qualifying_form_date,
            ARRAY_AGG(
                form_name IGNORE NULLS ORDER BY form_fill_date LIMIT 1
            )[SAFE_OFFSET(0)] AS first_qualifying_form_name,
            ARRAY_AGG(
                conversion_details IGNORE NULLS ORDER BY form_fill_date LIMIT 1
            )[SAFE_OFFSET(0)] AS first_qualifying_conversion_details
        FROM deal_contact_forms
        WHERE form_name IS NOT NULL
        GROUP BY deal_id
    ),

    deal_signup_aggregates AS (
        SELECT
            deal_id,
            COUNT(DISTINCT signup_date) AS signup_count,
            MIN(signup_date) AS first_signup_date
        FROM deal_contact_forms
        WHERE signup_date IS NOT NULL
        GROUP BY deal_id
    ),
    
    final_deals AS (
        SELECT
            d.deal_id,
            d.deal_name,
            d.deal_create_date,
            d.close_date,
            d.amount,
            d.stage_name,
            d.pipeline_name,
            d.enterprise_lead_source,
            d.is_closed_won,
            -- Aggregated form data
            COALESCE(dfa.qualifying_form_count, 0) AS qualifying_form_count,
            dfa.first_qualifying_form_date,
            dfa.first_qualifying_form_name,
            dfa.first_qualifying_conversion_details,
            -- Aggregated signup data
            COALESCE(dsa.signup_count, 0) AS signup_count,
            dsa.first_signup_date,
            -- Motion classification (3-way)
            CASE
                WHEN dfa.deal_id IS NOT NULL THEN 'Inbound'
                WHEN dsa.deal_id IS NOT NULL THEN 'Warm Outbound'
                ELSE 'Cold Outbound'
            END AS deal_motion
        FROM deal_contact_forms d
        LEFT JOIN deal_form_aggregates dfa ON d.deal_id = dfa.deal_id
        LEFT JOIN deal_signup_aggregates dsa ON d.deal_id = dsa.deal_id
        -- Deduplicate to one row per deal (deal_contact_forms can have multiple rows per deal)
        QUALIFY ROW_NUMBER() OVER (PARTITION BY d.deal_id ORDER BY d.deal_create_date) = 1
    )

-- Summary statistics
SELECT
    deal_motion,
    COUNT(*) AS deal_count,
    SUM(CAST(amount AS FLOAT64)) AS total_amount,
    AVG(CAST(amount AS FLOAT64)) AS avg_amount,
    SUM(CASE WHEN CAST(is_closed_won AS STRING) = 'true' THEN 1 ELSE 0 END) AS closed_won_count,
    SUM(CASE WHEN CAST(is_closed_won AS STRING) = 'true' THEN CAST(amount AS FLOAT64) ELSE 0 END) AS closed_won_amount
FROM final_deals
GROUP BY deal_motion
ORDER BY deal_count DESC;

-- Sample deals from each category
-- SELECT *
-- FROM final_deals
-- ORDER BY deal_create_date DESC
-- LIMIT 100;
