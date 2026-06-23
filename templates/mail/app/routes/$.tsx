import { NotFound } from "@/pages/NotFound";

export function meta() {
  return [{ title: "Not Found - Mail" }];
}

export default function CatchAllRoute() {
  return <NotFound />;
}
