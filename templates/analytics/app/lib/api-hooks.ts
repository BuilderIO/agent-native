import { useActionQuery } from "@agent-native/core/client";

// SEO data: map of blog handle -> { etv, ranked_keywords, ... }
export interface BlogPageSeo {
  url: string;
  handle: string;
  etv: number;
  ranked_keywords: number;
  estimated_paid_traffic_cost: number;
}

interface SeoResponse {
  pages: Record<string, BlogPageSeo>;
  total: number;
}

export function useBlogSeoData() {
  return useActionQuery("seo-blog-pages", undefined, {
    staleTime: 30 * 60 * 1000, // 30 min
    retry: 1,
  });
}

// SEO keywords for a specific blog slug
export interface RankedKeyword {
  keyword: string;
  search_volume: number;
  rank_absolute: number;
  url: string;
  etv: number;
}

interface KeywordsResponse {
  keywords: RankedKeyword[];
}

export function useBlogKeywords(slug: string | null) {
  return useActionQuery("seo-page-keywords", slug ? { slug } : undefined, {
    enabled: !!slug,
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });
}

// Bulk SEO keyword rankings with rank changes
export interface BlogKeywordRanking {
  keyword: string;
  search_volume: number;
  rank_absolute: number;
  prev_rank_absolute: number | null;
  is_new: boolean;
  is_up: boolean;
  is_down: boolean;
  url: string;
  handle: string;
  etv: number;
}

interface TopKeywordsResponse {
  keywords: BlogKeywordRanking[];
  total: number;
}

export function useTopBlogKeywords(limit = 500) {
  return useActionQuery(
    "seo-top-keywords",
    { limit: String(limit) },
    {
      staleTime: 30 * 60 * 1000,
      retry: 1,
    },
  );
}

// -- HubSpot CRM --

export interface HubSpotDeal {
  id: string;
  properties: {
    dealname: string;
    dealstage: string;
    amount: string | null;
    closedate: string | null;
    createdate: string;
    hs_lastmodifieddate: string;
    pipeline: string;
    hubspot_owner_id: string | null;
    [key: string]: string | null | undefined;
  };
}

interface HubSpotDealsResponse {
  deals: HubSpotDeal[];
  stageLabels: Record<string, string>;
  total: number;
}

export interface HubSpotPipeline {
  id: string;
  label: string;
  stages: { id: string; label: string; displayOrder: number }[];
}

interface HubSpotPipelinesResponse {
  pipelines: HubSpotPipeline[];
}

export interface HubSpotMetrics {
  totalDeals: number;
  totalPipelineValue: number;
  openDeals: number;
  openPipelineValue: number;
  wonDeals: number;
  wonValue: number;
  lostDeals: number;
  lostValue: number;
  avgDealSize: number;
  landingAcv: number;
  winRate: number;
  povSuccessRate: number;
  povEntered: number;
  povWon: number;
  dealsByStage: {
    stageId: string;
    stageLabel: string;
    count: number;
    value: number;
  }[];
}

export function useHubspotDeals() {
  return useActionQuery("hubspot-deals", undefined, {
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useHubspotPipelines() {
  return useActionQuery("hubspot-pipelines", undefined, {
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });
}

export function useHubspotMetrics() {
  return useActionQuery("hubspot-metrics", undefined, {
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

// -- Stripe Billing --

export interface StripeCustomerSummary {
  id: string;
  email: string | null;
  name: string | null;
}

export interface StripeInvoice {
  id: string;
  status: string | null;
  amount_due: number;
  amount_paid: number;
  currency: string;
  created: number;
  period_start: number;
  period_end: number;
  description: string | null;
  number: string | null;
  hosted_invoice_url: string | null;
  lines: {
    data: {
      description: string | null;
      amount: number;
      currency: string;
      period: { start: number; end: number };
    }[];
  };
}

export interface StripeCharge {
  id: string;
  amount: number;
  currency: string;
  status: string;
  created: number;
  description: string | null;
  failure_code: string | null;
  failure_message: string | null;
  paid: boolean;
  refunded: boolean;
  receipt_url: string | null;
}

export interface StripePaymentIntent {
  id: string;
  amount: number;
  currency: string;
  status: string;
  created: number;
  description: string | null;
  last_payment_error: {
    code: string;
    message: string;
    type: string;
  } | null;
}

export interface StripeSubscription {
  id: string;
  status: string;
  created: number;
  current_period_start: number;
  current_period_end: number;
  cancel_at_period_end: boolean;
  canceled_at: number | null;
  currency: string;
  items: {
    data: {
      id: string;
      price: {
        id: string;
        unit_amount: number | null;
        currency: string;
        recurring: { interval: string; interval_count: number } | null;
        product: string;
        productName?: string;
        nickname: string | null;
      };
      quantity: number;
    }[];
  };
}

export interface StripeRefund {
  id: string;
  amount: number;
  currency: string;
  status: string;
  created: number;
  reason: string | null;
  charge: string | null;
}

export interface ProductBillingAggregate {
  productId: string;
  productName: string;
  totalAmount: number;
  currency: string;
  invoiceCount: number;
}

interface StripeBillingResponse {
  customers: StripeCustomerSummary[];
  invoices: StripeInvoice[];
  total: number;
}

interface StripeBillingByProductResponse {
  customers: StripeCustomerSummary[];
  products: ProductBillingAggregate[];
  total: number;
}

interface StripePaymentStatusResponse {
  customers: StripeCustomerSummary[];
  charges: StripeCharge[];
  paymentIntents: StripePaymentIntent[];
}

interface StripeRefundsResponse {
  customers: StripeCustomerSummary[];
  refunds: StripeRefund[];
  total: number;
}

interface StripeSubscriptionsResponse {
  customers: StripeCustomerSummary[];
  subscriptions: StripeSubscription[];
  total: number;
}

// Helper to build action params for Stripe queries (auto-detects search type)
function buildStripeActionParams(
  searchInput: string,
  additionalParams?: Record<string, string | number>,
) {
  const trimmed = searchInput.trim();
  const params: Record<string, string | number> = {
    ...(additionalParams ?? {}),
  };

  // Auto-detect search type
  if (trimmed.startsWith("cus_")) {
    // Customer ID lookup
    params.customerId = trimmed;
  } else if (trimmed.includes("@")) {
    // Email search
    params.email = trimmed;
  } else {
    // Name or root_id search (backend tries name first, then root_id)
    params.query = trimmed;
  }

  return params;
}

export function useStripeBilling(
  searchInput: string,
  months: number,
  enabled: boolean,
) {
  const params = buildStripeActionParams(searchInput, {
    mode: "billing",
    months,
  });

  return useActionQuery<StripeBillingResponse>("stripe", params, {
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useStripeBillingByProduct(
  searchInput: string,
  months: number,
  enabled: boolean,
) {
  const params = buildStripeActionParams(searchInput, {
    mode: "billing-by-product",
    months,
  });

  return useActionQuery<StripeBillingByProductResponse>("stripe", params, {
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useStripePaymentStatus(searchInput: string, enabled: boolean) {
  const params = buildStripeActionParams(searchInput, {
    mode: "payment-status",
  });

  return useActionQuery<StripePaymentStatusResponse>("stripe", params, {
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useStripeRefunds(searchInput: string, enabled: boolean) {
  const params = buildStripeActionParams(searchInput, {
    mode: "refunds",
  });

  return useActionQuery<StripeRefundsResponse>("stripe", params, {
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useStripeSubscriptions(searchInput: string, enabled: boolean) {
  const params = buildStripeActionParams(searchInput, {
    mode: "subscriptions",
  });

  return useActionQuery<StripeSubscriptionsResponse>("stripe", params, {
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

// Notion content calendar
export interface ContentCalendarEntry {
  id: string;
  title: string;
  status: string;
  author: string;
  publishDate: string;
  url: string;
  handle: string;
  type: string;
  seoKeyword: string;
  msv: number | null;
  priority: string;
  objective: string;
  contentPillar: string;
  persona: string;
  properties: Record<string, string>;
}

interface ContentCalendarResponse {
  entries: ContentCalendarEntry[];
  total: number;
}

export function useContentCalendar() {
  return useActionQuery("content-calendar", undefined, {
    staleTime: 10 * 60 * 1000, // 10 min
    retry: 1,
  });
}
