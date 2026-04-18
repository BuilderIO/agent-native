import { useState } from "react";
import { useLoaderData, useRevalidator, Link } from "react-router";
import { eq } from "drizzle-orm";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { getDb, schema } from "../../server/db";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { callAction } from "@/lib/api";
import { toast } from "sonner";
import { IconPlus } from "@tabler/icons-react";

export async function loader() {
  const email = getRequestUserEmail() ?? "local@localhost";
  const rows = await getDb()
    .select()
    .from(schema.routingForms)
    .where(eq(schema.routingForms.ownerEmail, email));
  return { forms: rows };
}

export default function RoutingFormsIndex() {
  const { forms } = useLoaderData<typeof loader>();
  const rv = useRevalidator();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "" });
  const create = async () => {
    await callAction("create-routing-form", {
      name: form.name,
      fields: [
        {
          id: "company-size",
          name: "companySize",
          label: "Company size",
          type: "select",
          required: true,
          options: ["1-10", "11-50", "51-200", "200+"],
        },
      ],
      rules: [],
      fallback: {
        kind: "custom-message",
        message: "Thanks! We'll be in touch.",
      },
    });
    toast.success("Routing form created");
    setOpen(false);
    setForm({ name: "" });
    rv.revalidate();
  };
  return (
    <div className="mx-auto max-w-3xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Routing Forms
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Route prospects to the right event type based on their answers.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <IconPlus className="mr-2 h-4 w-4" />
              New form
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New routing form</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) =>
                    setForm({ ...form, name: e.currentTarget.value })
                  }
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={create} disabled={!form.name}>
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </header>
      {forms.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          No routing forms yet.
        </div>
      ) : (
        <ul className="space-y-2">
          {forms.map((f: any) => (
            <li
              key={f.id}
              className="flex items-center justify-between rounded-md border border-border p-4"
            >
              <div>
                <Link
                  to={`/routing-forms/${f.id}`}
                  className="font-medium hover:underline"
                >
                  {f.name}
                </Link>
                <div className="mt-1 text-xs text-muted-foreground">
                  /forms/{f.id}
                </div>
              </div>
              <Badge variant={f.disabled ? "secondary" : "default"}>
                {f.disabled ? "Disabled" : "Active"}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
