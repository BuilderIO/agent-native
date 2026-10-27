{{
    config(
        schema="dbt_analytics",
        materialized="table",
        tags=["daily", "analytics", "hubspot"],
    )
}}

with

    qualifying_forms as (
        select
            form_id,
            form_name,
            form_fill_date,
            email,
            b_visitor_id,
            conversion_details,
            form_type,
            form_intent
        from {{ ref("hubspot_form_submissions") }}
        where
            form_name is not null
            and (

                lower(form_name) like '%sales%'
                or lower(conversion_details) like '%sales%'

                or lower(form_name) like '%demo%'
                or lower(conversion_details) like '%demo%'

                or form_name = '[Marketing]  | Component Indexing Request'

                or conversion_details = 'Unlock Ent Trial'
            )
    ),

    deal_contact_forms as (
        select
            d.deal_id,
            d.deal_name,
            d.createdate as deal_create_date,
            d.close_date,
            d.amount,
            d.stage_name,
            d.pipeline_name,
            d.enterprise_lead_source,
            d.is_closed_won,
            dc.contact_id,
            c.email as contact_email,
            c.b_visitor_id as contact_visitor_id,
            c.builder_user_id as contact_user_id,
            ps.user_create_d as signup_date,
            qf.form_name,
            qf.form_fill_date,
            qf.conversion_details
        from {{ ref("dim_hs_deals") }} d

        left join
            {{ ref("hs_deals_to_contact_id") }} dc on d.deal_id = dc.deal_id

        left join
            {{ ref("dim_hs_contacts") }} c on dc.contact_id = c.contact_id


        left join
            qualifying_forms qf
            on (
                lower(qf.email) = lower(c.email)
                or (
                    qf.b_visitor_id is not null
                    and qf.b_visitor_id = c.b_visitor_id
                )
            )
            and qf.form_fill_date < d.createdate


        left join
            {{ ref("product_signups") }} ps
            on (
                lower(ps.email) = lower(c.email)
                or (
                    ps.user_id is not null
                    and ps.user_id = c.builder_user_id
                )
            )
            and ps.user_create_d < d.createdate
        where

            d.pipeline_name in ('Enterprise: New Business', 'Enterprise: White Label')
    ),

    deal_form_aggregates as (
        select
            deal_id,
            count(distinct form_name) as qualifying_form_count,
            min(form_fill_date) as first_qualifying_form_date,
            array_agg(
                form_name ignore nulls order by form_fill_date limit 1
            )[safe_offset(0)] as first_qualifying_form_name,
            array_agg(
                conversion_details ignore nulls order by form_fill_date
                limit 1
            )[safe_offset(0)] as first_qualifying_conversion_details
        from deal_contact_forms
        where form_name is not null
        group by deal_id
    ),

    deal_signup_aggregates as (
        select
            deal_id,
            count(distinct signup_date) as signup_count,
            min(signup_date) as first_signup_date
        from deal_contact_forms
        where signup_date is not null
        group by deal_id
    )

select
    d.deal_id,
    d.deal_name,
    d.deal_create_date,
    d.close_date,
    d.amount,
    d.stage_name,
    d.pipeline_name,
    d.enterprise_lead_source,
    d.is_closed_won,

    coalesce(dfa.qualifying_form_count, 0) as qualifying_form_count,
    dfa.first_qualifying_form_date,
    dfa.first_qualifying_form_name,
    dfa.first_qualifying_conversion_details,

    coalesce(dsa.signup_count, 0) as signup_count,
    dsa.first_signup_date,

    case
        when dfa.deal_id is not null then 'Inbound'
        when dsa.deal_id is not null then 'Warm Outbound'
        else 'Cold Outbound'
    end as deal_motion
from deal_contact_forms d
left join deal_form_aggregates dfa on d.deal_id = dfa.deal_id
left join deal_signup_aggregates dsa on d.deal_id = dsa.deal_id

qualify row_number() over (partition by d.deal_id order by d.deal_create_date) = 1
