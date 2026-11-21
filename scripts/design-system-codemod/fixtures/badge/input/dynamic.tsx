import { Badge } from "@agent-native/toolkit/ui/badge";

export function Dynamic({ tone }: { tone: "secondary" | "outline" }) {
  return <Badge variant={tone}>Dynamic</Badge>;
}
