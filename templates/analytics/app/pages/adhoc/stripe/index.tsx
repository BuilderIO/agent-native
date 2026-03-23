import { useState } from "react";
import {
  useStripeBilling,
  useStripeBillingByProduct,
  useStripePaymentStatus,
  useStripeRefunds,
  useStripeSubscriptions,
} from "@/lib/api-hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  AlertCircle,
  Receipt,
  CreditCard,
  RotateCcw,
  Repeat,
  Search,
  Package,
} from "lucide-react";
import { BillingHistory, BillingHistoryLoading } from "./BillingHistory";
import {
  BillingByProductHistory,
  BillingByProductHistoryLoading,
} from "./BillingByProductHistory";
import { PaymentStatus, PaymentStatusLoading } from "./PaymentStatus";
import { RefundStatus, RefundStatusLoading } from "./RefundStatus";
import { SubscriptionList, SubscriptionListLoading } from "./SubscriptionList";

function detectSearchType(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("cus_")) return "Customer ID";
  if (trimmed.includes("@")) return "Email";
  return "Name / Root ID";
}

export default function StripeBillingTool() {
  const [searchInput, setSearchInput] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [months, setMonths] = useState(6);

  const handleLookup = () => {
    if (!searchInput.trim()) return;
    setSubmittedSearch(searchInput.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleLookup();
  };

  const enabled = !!submittedSearch;
  const searchType = searchInput.trim() ? detectSearchType(searchInput) : null;

  const billingQuery = useStripeBilling(submittedSearch, months, enabled);
  const billingByProductQuery = useStripeBillingByProduct(
    submittedSearch,
    months,
    enabled,
  );
  const paymentQuery = useStripePaymentStatus(submittedSearch, enabled);
  const refundQuery = useStripeRefunds(submittedSearch, enabled);
  const subsQuery = useStripeSubscriptions(submittedSearch, enabled);

  const errors = [
    billingQuery.error,
    billingByProductQuery.error,
    paymentQuery.error,
    refundQuery.error,
    subsQuery.error,
  ].filter(Boolean) as Error[];

  // Dedupe errors (they'll often be the same message like "no customer found")
  const uniqueErrors = [...new Set(errors.map((e) => e.message))];

  const customerInfo =
    billingQuery.data?.customers ??
    billingByProductQuery.data?.customers ??
    paymentQuery.data?.customers ??
    refundQuery.data?.customers ??
    subsQuery.data?.customers;

  return (
    <div className="space-y-5">
      {/* Search input */}
      <Card>
        <CardContent className="pt-5 pb-4 px-5">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search by email, name, customer ID, or root ID"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={handleKeyDown}
                className="pl-9"
              />
              {searchType && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                    {searchType}
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <label className="text-xs text-muted-foreground whitespace-nowrap">
                Last
              </label>
              <Input
                type="number"
                min={1}
                max={36}
                value={months}
                onChange={(e) => setMonths(Number(e.target.value) || 6)}
                className="w-16 text-center"
              />
              <span className="text-xs text-muted-foreground">months</span>
            </div>
            <Button onClick={handleLookup} disabled={!searchInput.trim()}>
              Look Up
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2 px-1">
            Examples: john@example.com, John Smith, cus_ABC123, or root_12345
          </p>
        </CardContent>
      </Card>

      {/* Errors */}
      {uniqueErrors.length > 0 && (
        <Card className="bg-amber-950/20 border-amber-500/30">
          <CardContent className="py-3 px-4 flex items-start gap-3">
            <AlertCircle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
            <div className="text-xs space-y-1">
              <p className="font-medium text-amber-400">Stripe API error</p>
              {uniqueErrors.map((msg, i) => (
                <p key={i} className="text-muted-foreground">
                  {msg}
                </p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Customer info */}
      {customerInfo && customerInfo.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
          <span>Customer:</span>
          {customerInfo.map((c, i) => (
            <span key={c.id}>
              {i > 0 && ", "}
              <span className="font-medium text-foreground">
                {c.name || c.email}
              </span>
              <span className="ml-1 font-mono text-[10px]">({c.id})</span>
            </span>
          ))}
        </div>
      )}

      {/* All 5 sections shown at once */}
      {submittedSearch && (
        <div className="space-y-4">
          {/* Subscriptions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Repeat className="h-4 w-4" />
                Active Subscriptions
                {subsQuery.data && (
                  <span className="text-xs text-muted-foreground font-normal">
                    ({subsQuery.data.total} total)
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {subsQuery.isLoading ? (
                <SubscriptionListLoading />
              ) : subsQuery.error ? (
                <ErrorInline error={subsQuery.error as Error} />
              ) : subsQuery.data ? (
                <SubscriptionList
                  subscriptions={subsQuery.data.subscriptions}
                />
              ) : null}
            </CardContent>
          </Card>

          {/* Payment Status */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <CreditCard className="h-4 w-4" />
                Payment Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              {paymentQuery.isLoading ? (
                <PaymentStatusLoading />
              ) : paymentQuery.error ? (
                <ErrorInline error={paymentQuery.error as Error} />
              ) : paymentQuery.data ? (
                <PaymentStatus
                  charges={paymentQuery.data.charges}
                  paymentIntents={paymentQuery.data.paymentIntents}
                />
              ) : null}
            </CardContent>
          </Card>

          {/* Invoice History */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Receipt className="h-4 w-4" />
                Invoice History
                {billingQuery.data && (
                  <span className="text-xs text-muted-foreground font-normal">
                    ({billingQuery.data.total} invoices, last {months} months)
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {billingQuery.isLoading ? (
                <BillingHistoryLoading />
              ) : billingQuery.error ? (
                <ErrorInline error={billingQuery.error as Error} />
              ) : billingQuery.data ? (
                <BillingHistory invoices={billingQuery.data.invoices} />
              ) : null}
            </CardContent>
          </Card>

          {/* Billing by Product History */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Package className="h-4 w-4" />
                Billing by Product History
                {billingByProductQuery.data && (
                  <span className="text-xs text-muted-foreground font-normal">
                    ({billingByProductQuery.data.total} products, last {months}{" "}
                    months)
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {billingByProductQuery.isLoading ? (
                <BillingByProductHistoryLoading />
              ) : billingByProductQuery.error ? (
                <ErrorInline error={billingByProductQuery.error as Error} />
              ) : billingByProductQuery.data ? (
                <BillingByProductHistory
                  products={billingByProductQuery.data.products}
                />
              ) : null}
            </CardContent>
          </Card>

          {/* Refunds */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <RotateCcw className="h-4 w-4" />
                Refund Status
                {refundQuery.data && (
                  <span className="text-xs text-muted-foreground font-normal">
                    ({refundQuery.data.total} refunds)
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {refundQuery.isLoading ? (
                <RefundStatusLoading />
              ) : refundQuery.error ? (
                <ErrorInline error={refundQuery.error as Error} />
              ) : refundQuery.data ? (
                <RefundStatus refunds={refundQuery.data.refunds} />
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Empty state */}
      {!submittedSearch && (
        <div className="text-center py-12 text-muted-foreground">
          <CreditCard className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">
            Search by email, name, customer ID, or root ID to see customer
            Stripe data.
          </p>
        </div>
      )}
    </div>
  );
}

function ErrorInline({ error }: { error: Error }) {
  return <p className="text-xs text-amber-400 py-2">{error.message}</p>;
}
