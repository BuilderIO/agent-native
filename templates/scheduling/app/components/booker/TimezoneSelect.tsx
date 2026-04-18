/**
 * Timezone dropdown for the Booker header. Uses shadcn Select.
 */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const zones: string[] =
  typeof Intl !== "undefined" && (Intl as any).supportedValuesOf
    ? (Intl as any).supportedValuesOf("timeZone")
    : ["UTC"];

export interface TimezoneSelectProps {
  value: string;
  onChange: (tz: string) => void;
}

export function TimezoneSelect(props: TimezoneSelectProps) {
  return (
    <Select value={props.value} onValueChange={props.onChange}>
      <SelectTrigger className="w-[200px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-[300px] overflow-y-auto">
        {zones.map((tz) => (
          <SelectItem key={tz} value={tz}>
            {tz}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
