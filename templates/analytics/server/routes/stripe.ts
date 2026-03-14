import { type RequestHandler } from "express";
import { requireEnvKey } from "@agent-native/core/server";
import {
  getCustomersByEmail,
  getCustomerById,
  searchCustomersByName,
  getCustomersByRootId,
  getInvoices,
  getInvoicesByProduct,
  getCharges,
  getPaymentIntents,
  getSubscriptions,
  getRefunds,
} from "../lib/stripe";

async function resolveCustomer(req: { query: Record<string, any> }) {
  const { email, customerId, query } = req.query;

  // Direct customer ID lookup (fastest)
  if (customerId) {
    const customer = await getCustomerById(customerId);
    return [customer];
  }

  // Email search (existing behavior)
  if (email) {
    const customers = await getCustomersByEmail(email);
    if (customers.length === 0) {
      throw new Error(`No Stripe customer found for email: ${email}`);
    }
    return customers;
  }

  // Smart query search: try name first, then root_id metadata
  if (query) {
    // Try name search first
    let customers = await searchCustomersByName(query);

    // If no name matches, try root_id metadata search
    if (customers.length === 0) {
      customers = await getCustomersByRootId(query);
    }

    if (customers.length === 0) {
      throw new Error(`No Stripe customer found for: ${query}`);
    }

    return customers;
  }

  throw new Error("Must provide email, customerId, or query parameter");
}

// GET /api/stripe/billing?email=...&months=6
export const handleStripeBilling: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "STRIPE_SECRET_KEY", "Stripe")) return;
  try {
    const months = parseInt((req.query.months as string) || "6", 10);
    const customers = await resolveCustomer(req);

    const allInvoices = (
      await Promise.all(customers.map((c) => getInvoices(c.id, months)))
    ).flat();

    allInvoices.sort((a, b) => b.created - a.created);

    res.json({
      customers: customers.map((c) => ({
        id: c.id,
        email: c.email,
        name: c.name,
      })),
      invoices: allInvoices,
      total: allInvoices.length,
    });
  } catch (err: any) {
    console.error("Stripe billing error:", err.message);
    res
      .status(err.message.includes("not configured") ? 503 : 500)
      .json({ error: err.message });
  }
};

// GET /api/stripe/payment-status?email=...
export const handleStripePaymentStatus: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "STRIPE_SECRET_KEY", "Stripe")) return;
  try {
    const customers = await resolveCustomer(req);

    const [allCharges, allIntents] = await Promise.all([
      Promise.all(customers.map((c) => getCharges(c.id, 10))).then((r) =>
        r.flat(),
      ),
      Promise.all(customers.map((c) => getPaymentIntents(c.id, 10))).then((r) =>
        r.flat(),
      ),
    ]);

    allCharges.sort((a, b) => b.created - a.created);
    allIntents.sort((a, b) => b.created - a.created);

    res.json({
      customers: customers.map((c) => ({
        id: c.id,
        email: c.email,
        name: c.name,
      })),
      charges: allCharges,
      paymentIntents: allIntents,
    });
  } catch (err: any) {
    console.error("Stripe payment status error:", err.message);
    res
      .status(err.message.includes("not configured") ? 503 : 500)
      .json({ error: err.message });
  }
};

// GET /api/stripe/refunds?email=...
export const handleStripeRefunds: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "STRIPE_SECRET_KEY", "Stripe")) return;
  try {
    const customers = await resolveCustomer(req);

    const allRefunds = (
      await Promise.all(customers.map((c) => getRefunds(c.id)))
    ).flat();

    allRefunds.sort((a, b) => b.created - a.created);

    res.json({
      customers: customers.map((c) => ({
        id: c.id,
        email: c.email,
        name: c.name,
      })),
      refunds: allRefunds,
      total: allRefunds.length,
    });
  } catch (err: any) {
    console.error("Stripe refunds error:", err.message);
    res
      .status(err.message.includes("not configured") ? 503 : 500)
      .json({ error: err.message });
  }
};

// GET /api/stripe/subscriptions?email=...
export const handleStripeSubscriptions: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "STRIPE_SECRET_KEY", "Stripe")) return;
  try {
    const customers = await resolveCustomer(req);

    const allSubs = (
      await Promise.all(customers.map((c) => getSubscriptions(c.id)))
    ).flat();

    allSubs.sort((a, b) => b.created - a.created);

    res.json({
      customers: customers.map((c) => ({
        id: c.id,
        email: c.email,
        name: c.name,
      })),
      subscriptions: allSubs,
      total: allSubs.length,
    });
  } catch (err: any) {
    console.error("Stripe subscriptions error:", err.message);
    res
      .status(err.message.includes("not configured") ? 503 : 500)
      .json({ error: err.message });
  }
};

// GET /api/stripe/billing-by-product?email=...&months=6
export const handleStripeBillingByProduct: RequestHandler = async (
  req,
  res,
) => {
  if (requireEnvKey(res, "STRIPE_SECRET_KEY", "Stripe")) return;
  try {
    const months = parseInt((req.query.months as string) || "6", 10);
    const customers = await resolveCustomer(req);

    const allProducts = (
      await Promise.all(
        customers.map((c) => getInvoicesByProduct(c.id, months)),
      )
    ).flat();

    // Merge duplicates across multiple customers
    const productMap = new Map<string, (typeof allProducts)[0]>();
    for (const product of allProducts) {
      const existing = productMap.get(product.productId);
      if (existing) {
        existing.totalAmount += product.totalAmount;
        existing.invoiceCount += product.invoiceCount;
      } else {
        productMap.set(product.productId, { ...product });
      }
    }

    const products = Array.from(productMap.values()).sort(
      (a, b) => b.totalAmount - a.totalAmount,
    );

    res.json({
      customers: customers.map((c) => ({
        id: c.id,
        email: c.email,
        name: c.name,
      })),
      products,
      total: products.length,
    });
  } catch (err: any) {
    console.error("Stripe billing by product error:", err.message);
    res
      .status(err.message.includes("not configured") ? 503 : 500)
      .json({ error: err.message });
  }
};
