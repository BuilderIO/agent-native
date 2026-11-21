import { toast, type ExternalToast } from "sonner";

export function blocked(options: ExternalToast) {
  toast.success("Saved", options);
}
