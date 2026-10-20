import { useItemsStrings } from "../items-strings";
import { shortId } from "../items/format";
import type { PortLabeler } from "../items/port-label";
import type {
  NodeAuditInput,
  NodeAuditOutput,
  SampledItem,
} from "../items/read-types";

function SampleRow({
  item,
  onOpenItem,
}: {
  item: SampledItem;
  onOpenItem: (item: SampledItem) => void;
}) {
  const s = useItemsStrings();

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpenItem(item)}
        className="w-full rounded-md px-2 py-1.5 text-start transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span className="block truncate text-sm font-medium">
          {item.title ?? (
            <span className="font-mono text-xs">
              {shortId(item.itemId, 24)}
            </span>
          )}
        </span>
        <span className="line-clamp-2 break-words text-xs text-muted-foreground">
          {item.summary ?? s.audit.noSummary}
        </span>
      </button>
    </li>
  );
}

function SampleGroup({
  heading,
  items,
  total,
  truncated,
  onOpenItem,
}: {
  heading: string;
  items: SampledItem[];
  total: number;
  truncated: boolean;
  onOpenItem: (item: SampledItem) => void;
}) {
  const s = useItemsStrings();

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-foreground">{heading}</p>
      {items.length > 0 ? (
        <ul className="-mx-2">
          {items.map((item) => (
            <SampleRow key={item.itemId} item={item} onOpenItem={onOpenItem} />
          ))}
        </ul>
      ) : null}
      {truncated ? (
        <p className="text-xs text-muted-foreground">
          {s.audit.moreItems(items.length, total)}
        </p>
      ) : null}
    </div>
  );
}

/** What came in, edge by edge, with a few items to open. */
export function AuditInputs({
  inputs,
  nodeName,
  portLabel,
  onOpenItem,
}: {
  inputs: NodeAuditInput[];
  nodeName: (nodeId: string) => string;
  portLabel: PortLabeler;
  onOpenItem: (item: SampledItem) => void;
}) {
  const s = useItemsStrings();

  if (inputs.length === 0) {
    return <p className="text-xs text-muted-foreground">{s.audit.nothingIn}</p>;
  }
  return (
    <div className="space-y-3">
      {inputs.map((input) => (
        <SampleGroup
          key={input.edgeId}
          heading={s.audit.fromNode(
            input.count,
            nodeName(input.fromNodeId),
            portLabel(input.fromNodeId, input.fromPort),
          )}
          items={input.items}
          total={input.count}
          truncated={input.itemsTruncated}
          onOpenItem={onOpenItem}
        />
      ))}
    </div>
  );
}

/** What went out, port by port, with a few items to open. */
export function AuditOutputs({
  outputs,
  portLabel,
  onOpenItem,
}: {
  outputs: NodeAuditOutput[];
  portLabel: (port: string) => string;
  onOpenItem: (item: SampledItem) => void;
}) {
  const s = useItemsStrings();

  if (outputs.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">{s.audit.nothingOut}</p>
    );
  }
  return (
    <div className="space-y-3">
      {outputs.map((output) => (
        <SampleGroup
          key={output.port}
          heading={s.audit.portCount(portLabel(output.port), output.count)}
          items={output.items}
          total={output.count}
          truncated={output.itemsTruncated}
          onOpenItem={onOpenItem}
        />
      ))}
    </div>
  );
}
