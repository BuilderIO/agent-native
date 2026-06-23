import NotFound from "@/pages/NotFound";

export function meta() {
  return [{ title: "Not Found - Design" }];
}

export default function CatchAllRoute() {
  return <NotFound />;
}
