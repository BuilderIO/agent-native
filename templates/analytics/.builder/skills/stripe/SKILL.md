---
name: stripe
description: How to connect to and query the Stripe API for analytics data.
---

# Stripe Integration

## Connection

- **Base URL**: `https://api.stripe.com`
- **Auth**: Bearer token via the per-user/org `STRIPE_SECRET_KEY` credential
- **Server lib**: `server/lib/stripe.ts`
- **Routes**: `server/routes/stripe.ts`
- **Dashboard**: `app/pages/adhoc/stripe/` (tool page, not metrics dashboard)

## Credential

- `STRIPE_SECRET_KEY` — configure in Settings → Data sources

## Agent Action

Use `stripe` for agent-facing Stripe work. Do not call `/api/stripe/*`
directly from the agent.

| Mode | Args | Description |
| --- | --- | --- |
| `billing` | `email`, `customerId`, `query`, `months` | Invoices for a customer in timeframe |
| `payment-status` | `email`, `customerId`, `query` | Recent charges + payment intents |
| `refunds` | `email`, `customerId`, `query` | Refunds associated with customer |
| `subscriptions` | `email`, `customerId`, `query` | Active subscriptions |
| `billing-by-product` | `email`, `customerId`, `query`, `months` | Billing aggregated by product |

## API Routes

| Route                        | Method | Params                        | Description                           |
| ---------------------------- | ------ | ----------------------------- | ------------------------------------- |
| `/api/stripe/billing`        | GET    | `email`, `months` (default 6) | Invoices for a customer in timeframe  |
| `/api/stripe/payment-status` | GET    | `email`                       | Recent charges + payment intents      |
| `/api/stripe/refunds`        | GET    | `email`                       | Refunds associated with customer      |
| `/api/stripe/subscriptions`  | GET    | `email`                       | All subscriptions (active + inactive) |

All routes resolve email → Stripe customer ID(s) internally.

## Exported Functions (server/lib/stripe.ts)

- `getCustomersByEmail(email)` — lookup customers by email
- `getInvoices(customerId, months?)` — invoices, optionally filtered by timeframe
- `getCharges(customerId, limit?)` — recent charges
- `getPaymentIntents(customerId, limit?)` — recent payment intents
- `getSubscriptions(customerId)` — all subscriptions (status=all)
- `getRefunds(customerId)` — refunds via charge lookup

## Gotchas

- Stripe `/v1/refunds` does NOT support `customer` filter. The lib works around this by fetching customer charges first, then fetching refunds for refunded charges.
- One email can map to multiple Stripe customer objects. All routes handle this by aggregating across all matching customers.
- Amounts in Stripe are in **cents** (smallest currency unit). Divide by 100 for display.
- Cache TTL is 5 minutes (shorter than other integrations since billing data changes more frequently).
- The `expand` parameter is used for invoices (line items) and subscriptions (price details).

## Client Hooks (app/lib/api-hooks.ts)

- `useStripeBilling(email, months, enabled)`
- `useStripePaymentStatus(email, enabled)`
- `useStripeRefunds(email, enabled)`
- `useStripeSubscriptions(email, enabled)`

All hooks use `enabled` flag — data is only fetched when a button is clicked.

## UI Pattern

The Stripe page is a **tool** (not a dashboard). It has:

1. Email input field
2. Four action buttons (Billing History, Payment Status, Refund Status, Subscriptions)
3. Results panel that shows data for whichever action was last triggered
