import { TextArea } from "./components/ui/textarea";

export function Notes({ value }: { value: string }) {
  return (
    <>
      <TextArea value={value} rows={4} />
      <TextArea className="min-h-24">{value}</TextArea>
    </>
  );
}
