import { Textarea } from "./components/ui/textarea";

export function Notes({ value }: { value: string }) {
  return (
    <>
      <Textarea value={value} rows={4} />
      <Textarea className="min-h-24">{value}</Textarea>
    </>
  );
}
