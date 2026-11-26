import { Input, InputSlot } from "@agent-native/toolkit/ui/base-ui/input";
import { IconSearch } from "@tabler/icons-react";

export function Search({ value }: { value: string }) {
  return (
    <div>
      <Input value={value} onChange={() => {}} placeholder="Search" />
      <Input className="w-40" />
      <Input>
        <InputSlot side="left">
          <IconSearch />
        </InputSlot>
        <InputSlot side="right">{"⌘K"}</InputSlot>
      </Input>
      <Input className="h-7" type="email" />
    </div>
  );
}
