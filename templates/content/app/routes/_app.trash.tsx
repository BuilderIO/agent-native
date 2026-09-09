import { TrashBrowser } from "@/components/trash/TrashBrowser";
import { TrashRecoveryActions } from "@/components/trash/TrashRecoveryActions";

export default function TrashRoute() {
  return (
    <TrashBrowser
      renderActions={(items, onComplete) => (
        <TrashRecoveryActions items={items} onComplete={onComplete} />
      )}
    />
  );
}
