import NotFound from "@/pages/NotFound";

export function meta() {
  return [{ title: "Not Found — Remotion Studio" }];
}

export default function CatchAllRoute() {
  return <NotFound />;
}
