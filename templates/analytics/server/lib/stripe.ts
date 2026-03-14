// Stripe API helper
// Fetches customers, invoices, charges, subscriptions, refunds

const API_BASE = "https://api.stripe.com";

const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE = 120;

function getToken(): string {
  const token = process.env.STRIPE_SECRET_KEY;
  if (!token)
    throw new Error(
      "STRIPE_SECRET_KEY env var not configured. Add your Stripe secret key to continue.",
    );
  return token;
}

async function apiGet<T>(
  path: string,
  params?: Record<string, string | string[]>,
  cacheKey?: string,
): Promise<T> {
  let qs = "";
  if (params) {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) {
        for (const item of v)
          parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(item)}`);
      } else {
        parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
      }
    }
    qs = parts.length ? "?" + parts.join("&") : "";
  }
  const url = `${API_BASE}${path}${qs}`;
  const key = cacheKey ?? url;

  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data as T;
  }

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${getToken()}`,
      "Stripe-Version": "2023-10-16",
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = body?.error?.message || `Stripe API error ${res.status}`;
    throw new Error(msg);
  }

  const data = await res.json();

  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { data, ts: Date.now() });

  return data as T;
}

// -- Types --

export interface StripeCustomer {
  id: string;
  email: string | null;
  name: string | null;
  created: number;
  currency: string | null;
  delinquent: boolean;
  metadata: Record<string, string>;
}

export interface StripeInvoice {
  id: string;
  customer: string;
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
  customer: string | StripeCustomer;
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
        recurring: {
          interval: string;
          interval_count: number;
        } | null;
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
  receipt_number: string | null;
}

interface StripeList<T> {
  object: "list";
  data: T[];
  has_more: boolean;
  url: string;
}

// -- Exported functions --

export async function getCustomersByEmail(
  email: string,
): Promise<StripeCustomer[]> {
  const res = await apiGet<StripeList<StripeCustomer>>("/v1/customers", {
    email,
    limit: "10",
  });
  return res.data;
}

export async function searchCustomersByName(
  name: string,
): Promise<StripeCustomer[]> {
  const escapedName = name.replace(/'/g, "\\'");

  // Stage 1: Try exact name match
  let query = `name:'${escapedName}'`;
  let res = await apiGet<StripeList<StripeCustomer>>("/v1/customers/search", {
    query,
    limit: "10",
  });

  if (res.data.length > 0) {
    return res.data; // Found exact matches
  }

  // Stage 2: Try partial name match
  query = `name~'${escapedName}'`;
  res = await apiGet<StripeList<StripeCustomer>>("/v1/customers/search", {
    query,
    limit: "10",
  });

  if (res.data.length > 0) {
    return res.data; // Found partial matches
  }

  // Stage 3: Try multi-field search (name OR email)
  query = `name~'${escapedName}' OR email~'${escapedName}'`;
  res = await apiGet<StripeList<StripeCustomer>>("/v1/customers/search", {
    query,
    limit: "10",
  });

  return res.data; // Return whatever we found (may be empty)
}

export async function getCustomerById(
  customerId: string,
): Promise<StripeCustomer> {
  return await apiGet<StripeCustomer>(`/v1/customers/${customerId}`);
}

export async function getCustomersByRootId(
  rootId: string,
): Promise<StripeCustomer[]> {
  // Search subscriptions by root_id metadata, then get unique customers
  const query = `metadata['root_id']:'${rootId.replace(/'/g, "\\'")}'`;
  const res = await apiGet<StripeList<StripeSubscription>>(
    "/v1/subscriptions/search",
    {
      query,
      limit: "100",
      "expand[]": "data.customer",
    },
  );

  // Extract unique customer IDs
  const customerIds = new Set<string>();
  for (const sub of res.data) {
    if (typeof sub.customer === "string") {
      customerIds.add(sub.customer);
    } else if (sub.customer && typeof sub.customer === "object") {
      customerIds.add(sub.customer.id);
    }
  }

  // Fetch full customer objects
  const customers: StripeCustomer[] = [];
  for (const customerId of customerIds) {
    try {
      const customer = await getCustomerById(customerId);
      customers.push(customer);
    } catch (err) {
      console.warn(`Failed to fetch customer ${customerId}:`, err);
    }
  }

  return customers;
}

export async function getInvoices(
  customerId: string,
  months?: number,
): Promise<StripeInvoice[]> {
  const params: Record<string, string[]> = {
    customer: [customerId],
    limit: ["100"],
    "expand[]": ["data.lines"],
  };
  if (months && months > 0) {
    const since = Math.floor(Date.now() / 1000) - months * 30 * 86400;
    params["created[gte]"] = [String(since)];
  }
  const res = await apiGet<StripeList<StripeInvoice>>("/v1/invoices", params);
  return res.data;
}

export interface ProductBillingAggregate {
  productId: string;
  productName: string;
  totalAmount: number;
  currency: string;
  invoiceCount: number;
}

interface StripeProduct {
  id: string;
  name: string;
  description: string | null;
}

export async function getInvoicesByProduct(
  customerId: string,
  months?: number,
): Promise<ProductBillingAggregate[]> {
  const invoices = await getInvoices(customerId, months);
  const productMap = new Map<
    string,
    { totalAmount: number; currency: string; invoiceCount: number }
  >();
  const productIds = new Set<string>();

  // First pass: aggregate amounts by product ID
  for (const invoice of invoices) {
    if (!invoice.lines?.data) continue;

    for (const line of invoice.lines.data) {
      // @ts-ignore - price.product exists on invoice line items
      const productId = line.price?.product;
      if (!productId || typeof productId !== "string") continue;

      productIds.add(productId);

      const existing = productMap.get(productId);
      if (existing) {
        existing.totalAmount += line.amount;
        existing.invoiceCount += 1;
      } else {
        productMap.set(productId, {
          totalAmount: line.amount,
          currency: line.currency || invoice.currency,
          invoiceCount: 1,
        });
      }
    }
  }

  // Second pass: fetch product details
  const productDetails = new Map<string, string>();
  for (const productId of productIds) {
    try {
      const product = await apiGet<StripeProduct>(`/v1/products/${productId}`);
      productDetails.set(productId, product.name || productId);
    } catch (err) {
      // If product fetch fails, just use the ID
      productDetails.set(productId, productId);
    }
  }

  // Combine data
  const results: ProductBillingAggregate[] = [];
  for (const [productId, data] of productMap.entries()) {
    results.push({
      productId,
      productName: productDetails.get(productId) || productId,
      totalAmount: data.totalAmount,
      currency: data.currency,
      invoiceCount: data.invoiceCount,
    });
  }

  return results.sort((a, b) => b.totalAmount - a.totalAmount);
}

export async function getCharges(
  customerId: string,
  limit = 25,
): Promise<StripeCharge[]> {
  const res = await apiGet<StripeList<StripeCharge>>("/v1/charges", {
    customer: customerId,
    limit: String(limit),
  });
  return res.data;
}

export async function getPaymentIntents(
  customerId: string,
  limit = 25,
): Promise<StripePaymentIntent[]> {
  const res = await apiGet<StripeList<StripePaymentIntent>>(
    "/v1/payment_intents",
    {
      customer: customerId,
      limit: String(limit),
    },
  );
  return res.data;
}

export async function getSubscriptions(
  customerId: string,
): Promise<StripeSubscription[]> {
  // Only fetch active subscriptions (active, trialing, past_due)
  // Multiple status values require multiple API calls or client-side filtering
  const res = await apiGet<StripeList<StripeSubscription>>(
    "/v1/subscriptions",
    {
      customer: customerId,
      limit: "100",
      status: "all",
      "expand[]": "data.items.data.price",
    },
  );

  // Filter to only active statuses
  const activeStatuses = ["active", "trialing", "past_due"];
  const subscriptions = res.data.filter((sub) =>
    activeStatuses.includes(sub.status),
  );

  // Collect all unique product IDs
  const productIds = new Set<string>();
  for (const sub of subscriptions) {
    for (const item of sub.items?.data ?? []) {
      if (item.price?.product && typeof item.price.product === "string") {
        productIds.add(item.price.product);
      }
    }
  }

  // Fetch product details
  const productNames = new Map<string, string>();
  for (const productId of productIds) {
    try {
      const product = await apiGet<StripeProduct>(`/v1/products/${productId}`);
      productNames.set(productId, product.name || productId);
    } catch (err) {
      productNames.set(productId, productId);
    }
  }

  // Augment subscriptions with product names
  for (const sub of subscriptions) {
    for (const item of sub.items?.data ?? []) {
      if (item.price?.product && typeof item.price.product === "string") {
        const productId = item.price.product;
        // @ts-ignore - Adding productName to the price object
        item.price.productName = productNames.get(productId) || productId;
      }
    }
  }

  return subscriptions;
}

export async function getRefunds(customerId: string): Promise<StripeRefund[]> {
  // Stripe /v1/refunds doesn't support customer filter directly,
  // so we get charges first, then fetch refunds for each refunded charge
  const charges = await getCharges(customerId, 100);
  const refundedCharges = charges.filter((c) => c.refunded);

  if (refundedCharges.length === 0) {
    // Also try fetching recent refunds and matching by charge ownership
    const allRefunds = await apiGet<StripeList<StripeRefund>>("/v1/refunds", {
      limit: "100",
    });
    const chargeIds = new Set(charges.map((c) => c.id));
    return allRefunds.data.filter((r) => r.charge && chargeIds.has(r.charge));
  }

  const refunds: StripeRefund[] = [];
  for (const charge of refundedCharges) {
    const res = await apiGet<StripeList<StripeRefund>>("/v1/refunds", {
      charge: charge.id,
      limit: "100",
    });
    refunds.push(...res.data);
  }
  return refunds;
}
