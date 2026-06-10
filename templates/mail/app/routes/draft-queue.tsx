import { DraftQueuePage } from "@/pages/DraftQueuePage";

export function meta() {
  return [{ title: "Draft Queue — Mail" }];
}

export default function DraftQueueRoute() {
  return <DraftQueuePage />;
}
