import { toast } from "sonner";

declare function save(): Promise<void>;

export function unsupported(ok: boolean) {
  toast.promise(save(), { loading: "Saving", success: "Saved", error: "Failed" });
  toast.custom(() => <div>Custom</div>);
  toast.error("Failed", { className: "wide", icon: <span>!</span> });
  toast(<strong>Bold</strong>);
  const show = ok ? toast.success : toast.error;
  show("x");
  return ok && toast("Inline", { action: { label: "Undo", onClick: () => {} } });
}

export function computed(kind: "success" | "error") {
  toast[kind]("Picked at runtime");
}
