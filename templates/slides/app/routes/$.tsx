import NotFound from "@/pages/NotFound";

export function meta() {
  return [{ title: "Not Found - Slides" }];
}

export default function CatchAllRoute() {
  return <NotFound />;
}
