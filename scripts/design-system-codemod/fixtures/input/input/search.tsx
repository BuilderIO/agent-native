import { IconSearch } from "@tabler/icons-react";

import { Input } from "@agent-native/toolkit/ui/input";

export function Search({ value }: { value: string }) {
  return (
    <div>
      <Input value={value} onChange={() => {}} placeholder="Search" />
      <Input size="sm" className="w-40" />
      <Input leading={<IconSearch />} trailing="⌘K" />
      <Input className="h-7" type="email" />
    </div>
  );
}
