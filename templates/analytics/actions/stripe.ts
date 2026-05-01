import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  getCharges,
  getCustomerById,
  getCustomersByEmail,
  getCustomersByRootId,
  getInvoices,
  getInvoicesByProduct,
  getPaymentIntents,
  getRefunds,
  getSubscriptions,
  searchCustomersByName,
  type StripeCustomer,
} from "../server/lib/stripe";
import {
  providerError,
  requireActionCredentials,
} from "./_provider-action-utils";

async function resolveCustomers(args: {
  email?: string;
  customerId?: string;
  query?: string;
}): Promise<StripeCustomer[]> {
  if (args.customerId) return [await getCustomerById(args.customerId)];
  if (args.email) return await getCustomersByEmail(args.email);
  if (args.query) {
    const byName = await searchCustomersByName(args.query);
    if (byName.length > 0) return byName;
    return await getCustomersByRootId(args.query);
  }
  throw new Error("Provide email, customerId, or query");
}

function summarizeCustomers(customers: StripeCustomer[]) {
  return customers.map((customer) => ({
    id: customer.id,
    email: customer.email,
    name: customer.name,
  }));
}

export default defineAction({
  description:
    "Query Stripe billing, payment status, refunds, subscriptions, and billing by product for a customer.",
  schema: z.object({
    mode: z
      .enum([
        "billing",
        "payment-status",
        "refunds",
        "subscriptions",
        "billing-by-product",
      ])
      .default("billing")
      .describe("What Stripe data to query"),
    email: z.string().optional().describe("Customer email"),
    customerId: z.string().optional().describe("Stripe customer ID"),
    query: z
      .string()
      .optional()
      .describe("Customer search term, name, email, or root_id"),
    months: z.coerce
      .number()
      .int()
      .min(1)
      .max(60)
      .default(6)
      .describe("Months of billing history"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const credentials = await requireActionCredentials(
      ["STRIPE_SECRET_KEY"],
      "Stripe",
    );
    if (!credentials.ok) return credentials.response;

    try {
      const customers = await resolveCustomers(args);
      if (customers.length === 0) {
        return { customers: [], total: 0 };
      }

      if (args.mode === "payment-status") {
        const [charges, paymentIntents] = await Promise.all([
          Promise.all(customers.map((c) => getCharges(c.id, 10))).then((r) =>
            r.flat(),
          ),
          Promise.all(customers.map((c) => getPaymentIntents(c.id, 10))).then(
            (r) => r.flat(),
          ),
        ]);
        charges.sort((a, b) => b.created - a.created);
        paymentIntents.sort((a, b) => b.created - a.created);
        return {
          customers: summarizeCustomers(customers),
          charges,
          paymentIntents,
        };
      }

      if (args.mode === "refunds") {
        const refunds = (
          await Promise.all(customers.map((c) => getRefunds(c.id)))
        ).flat();
        refunds.sort((a, b) => b.created - a.created);
        return {
          customers: summarizeCustomers(customers),
          refunds,
          total: refunds.length,
        };
      }

      if (args.mode === "subscriptions") {
        const subscriptions = (
          await Promise.all(customers.map((c) => getSubscriptions(c.id)))
        ).flat();
        subscriptions.sort((a, b) => b.created - a.created);
        return {
          customers: summarizeCustomers(customers),
          subscriptions,
          total: subscriptions.length,
        };
      }

      if (args.mode === "billing-by-product") {
        const productRows = (
          await Promise.all(
            customers.map((c) => getInvoicesByProduct(c.id, args.months)),
          )
        ).flat();
        const productMap = new Map<string, (typeof productRows)[0]>();
        for (const product of productRows) {
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
        return {
          customers: summarizeCustomers(customers),
          products,
          total: products.length,
        };
      }

      const invoices = (
        await Promise.all(customers.map((c) => getInvoices(c.id, args.months)))
      ).flat();
      invoices.sort((a, b) => b.created - a.created);
      return {
        customers: summarizeCustomers(customers),
        invoices,
        total: invoices.length,
      };
    } catch (err) {
      return providerError(err);
    }
  },
});
