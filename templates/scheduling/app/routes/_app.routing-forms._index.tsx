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
  DialogDescription,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { callAction } from "@/lib/api";
import { toast } from "sonner";
import { useSetHeaderActions } from "@/components/layout/HeaderActions";
import {
  IconCopy,
  IconDotsVertical,
  IconExternalLink,
  IconPlus,
  IconRoute,
  IconTrash,
} from "@tabler/icons-react";

export async function loader() {
  const email = getRequestUserEmail();
  if (!email) throw new Response("Unauthenticated", { status: 401 });
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
  const [form, setForm] = useState({ name: "", description: "" });

  const create = async () => {
    if (!form.name) return;
    await callAction("create-routing-form", {
      name: form.name,
      description: form.description,
      fields: [],
      rules: [],
      fallback: {
        kind: "custom-message",
        message: "Thanks! We'll be in touch.",
      },
    });
    toast.success("Routing form created");
    setOpen(false);
    setForm({ name: "", description: "" });
    rv.revalidate();
  };

  const remove = async (id: string) => {
    await callAction("delete-routing-form", { id });
    toast.success("Form deleted");
    rv.revalidate();
  };

  useSetHeaderActions(
    <Button onClick={() => setOpen(true)} className="cursor-pointer">
      <IconPlus className="mr-1.5 h-4 w-4" />
      New
    </Button>,
  );

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a new routing form</DialogTitle>
            <DialogDescription>
              Give your form a name. You'll add fields and rules next.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                placeholder="Prospect intake"
                value={form.name}
                onChange={(e) =>
                  setForm({ ...form, name: e.currentTarget.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input
                placeholder="Shown to visitors on the form page"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.currentTarget.value })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={create} disabled={!form.name}>
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {forms.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border p-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <IconRoute className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Create a routing form</h2>
            <p className="text-sm text-muted-foreground">
              Route prospects to the right event type based on their answers.
            </p>
          </div>
          <Button onClick={() => setOpen(true)} className="mt-2">
            <IconPlus className="mr-1.5 h-4 w-4" />
            New routing form
          </Button>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card">
          {forms.map((f: any) => {
            const fieldCount = Array.isArray(f.fields) ? f.fields.length : 0;
            const url = `/forms/${f.id}`;
            return (
              <li
                key={f.id}
                className="flex items-start gap-3 p-4 hover:bg-muted/30"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/routing-forms/${f.id}`}
                      className="truncate font-semibold hover:underline"
                    >
                      {f.name}
                    </Link>
                    {f.disabled && (
                      <Badge variant="outline" className="text-[10px]">
                        Disabled
                      </Badge>
                    )}
                    <Badge variant="secondary" className="text-[10px]">
                      {fieldCount} field{fieldCount === 1 ? "" : "s"}
                    </Badge>
                  </div>
                  {f.description && (
                    <div className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                      {f.description}
                    </div>
                  )}
                  <code className="mt-1 block truncate text-xs text-muted-foreground">
                    {url}
                  </code>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => {
                      navigator.clipboard?.writeText(location.origin + url);
                      toast.success("Link copied");
                    }}
                    aria-label="Copy link"
                  >
                    <IconCopy className="h-4 w-4" />
                  </Button>
                  <Button
                    asChild
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                  >
                    <a href={url} target="_blank" rel="noreferrer">
                      <IconExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="ghost" className="h-8 w-8">
                        <IconDotsVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link to={`/routing-forms/${f.id}`}>Edit</Link>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => remove(f.id)}
                      >
                        <IconTrash className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
