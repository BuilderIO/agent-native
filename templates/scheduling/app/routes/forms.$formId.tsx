/**
 * Public routing form URL: `/forms/:formId`.
 * Renders the form, evaluates rules on submit, and redirects to the
 * resolved action (event type / external URL / message).
 */
import { useLoaderData, useNavigate } from "react-router";
import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../../server/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export async function loader({ params }: LoaderFunctionArgs) {
  const rows = await getDb()
    .select()
    .from(schema.routingForms)
    .where(eq(schema.routingForms.id, params.formId!));
  if (!rows[0] || rows[0].disabled)
    throw new Response("Form not found", { status: 404 });
  const row = rows[0];
  return {
    form: {
      id: row.id,
      name: row.name,
      description: row.description,
      fields: JSON.parse(row.fields),
      rules: JSON.parse(row.rules),
      fallback: row.fallback ? JSON.parse(row.fallback) : null,
    },
  };
}

export default function RoutingFormPublic() {
  const { form } = useLoaderData<typeof loader>();
  const [values, setValues] = useState<Record<string, any>>({});
  const [message, setMessage] = useState<string | null>(null);
  const navigate = useNavigate();

  const submit = async () => {
    const matched = evaluateRules(form.rules, values);
    const action = matched ?? form.fallback;
    // Persist the response
    await fetch("/_agent-native/actions/submit-routing-form-response", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        formId: form.id,
        response: values,
        matchedRuleId: matched?.ruleId,
      }),
    }).catch(() => {});
    if (!action) return;
    if (action.kind === "event-type") {
      navigate(
        `/e/${action.eventTypeId}?prefill=${encodeURIComponent(JSON.stringify(values))}`,
      );
    } else if (action.kind === "external-url") {
      location.href = action.url;
    } else {
      setMessage(action.message);
    }
  };

  if (message) {
    return (
      <main className="mx-auto max-w-md p-6 text-center">
        <p className="text-lg">{message}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-xl font-semibold">{form.name}</h1>
      {form.description && (
        <p className="mt-1 text-sm text-muted-foreground">{form.description}</p>
      )}
      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {form.fields.map((f: any) => (
          <div key={f.id} className="space-y-1">
            <Label>{f.label}</Label>
            {f.type === "select" ? (
              <Select
                value={values[f.id] ?? ""}
                onValueChange={(v) => setValues({ ...values, [f.id]: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose…" />
                </SelectTrigger>
                <SelectContent>
                  {f.options?.map((o: string) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                type={
                  f.type === "email"
                    ? "email"
                    : f.type === "number"
                      ? "number"
                      : "text"
                }
                required={f.required}
                value={values[f.id] ?? ""}
                onChange={(e) =>
                  setValues({ ...values, [f.id]: e.currentTarget.value })
                }
              />
            )}
          </div>
        ))}
        <Button type="submit" className="w-full">
          Continue
        </Button>
      </form>
    </main>
  );
}

function evaluateRules(rules: any[], values: Record<string, any>) {
  for (const rule of rules) {
    const matches = (rule.conditions ?? []).every((c: any) => {
      const v = values[c.fieldId];
      switch (c.op) {
        case "equals":
          return v === c.value;
        case "not-equals":
          return v !== c.value;
        case "contains":
          return typeof v === "string" && v.includes(c.value);
        case "starts-with":
          return typeof v === "string" && v.startsWith(c.value);
        case "in":
          return Array.isArray(c.value) && c.value.includes(v);
        default:
          return false;
      }
    });
    if (matches) return { ruleId: rule.id, ...rule.action };
  }
  return null;
}
