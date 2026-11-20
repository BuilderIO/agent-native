import { Badge } from "@agent-native/toolkit/ui/base-ui/badge";

export function Status() {
  return (
    <div>
      <Badge variant="solid">New</Badge>
      <Badge variant="soft" color="gray">
        Draft
      </Badge>
      <Badge variant="solid" color="danger" size="1">
        Failed
      </Badge>
      <Badge variant="outline" color="gray" className="font-mono">
        v2
      </Badge>
    </div>
  );
}
