import NotFound from "@/pages/NotFound";

export function meta() {
  return [{ title: "Not Found - Analytics" }];
}

export default function CatchAllRoute() {
  return <NotFound />;
}
