import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { callAction } from "@/lib/api";
import { toast } from "sonner";

export default function ProfileSettings() {
  const [form, setForm] = useState({
    name: "",
    bio: "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    brandColor: "#7c3aed",
    darkBrandColor: "#a78bfa",
  });
  const save = async () => {
    await callAction("update-profile", form);
    toast.success("Saved");
  };
  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">Profile</h1>
      <div className="mt-6 space-y-4">
        <Field label="Name">
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
          />
        </Field>
        <Field label="Bio">
          <Input
            value={form.bio}
            onChange={(e) => setForm({ ...form, bio: e.currentTarget.value })}
          />
        </Field>
        <Field label="Timezone">
          <Input
            value={form.timezone}
            onChange={(e) =>
              setForm({ ...form, timezone: e.currentTarget.value })
            }
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Brand color (light)">
            <Input
              type="color"
              value={form.brandColor}
              onChange={(e) =>
                setForm({ ...form, brandColor: e.currentTarget.value })
              }
            />
          </Field>
          <Field label="Brand color (dark)">
            <Input
              type="color"
              value={form.darkBrandColor}
              onChange={(e) =>
                setForm({ ...form, darkBrandColor: e.currentTarget.value })
              }
            />
          </Field>
        </div>
        <Button onClick={save}>Save</Button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
