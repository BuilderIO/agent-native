function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-[5px] rounded-[10px] border border-border px-4 pt-3.5 pb-3">
      <div className="overflow-hidden text-sm font-medium leading-[16.1px] text-[hsl(var(--forms-keycap))]">
        {label}
      </div>
      <div className="relative text-xl font-medium leading-[23px]">{value}</div>
    </div>
  );
}

export function MetricRow({
  metrics,
  ready,
}: {
  metrics: readonly (readonly [string, string])[];
  ready: boolean;
}) {
  return (
    <div className="mb-8 flex flex-wrap gap-5 [&>*]:min-w-[200px] [&>*]:flex-1">
      {metrics.map(([label, value]) => (
        <MetricCard key={label} label={label} value={ready ? value : "..."} />
      ))}
    </div>
  );
}
