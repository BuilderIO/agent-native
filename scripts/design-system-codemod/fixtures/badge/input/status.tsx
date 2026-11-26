import { Badge } from "@agent-native/toolkit/ui/badge";

export function Status() {
  return (
    <div>
      <Badge>New</Badge>
      <Badge variant="secondary">Draft</Badge>
      <Badge variant="destructive" size="sm">
        Failed
      </Badge>
      <Badge variant="outline" className="font-mono">
        v2
      </Badge>
    </div>
  );
}
