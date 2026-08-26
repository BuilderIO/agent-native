import { parseSlackMrkdwn, type SlackMrkdwnNode } from "./slack-mrkdwn";

export function SlackMrkdwn({ text }: { text: string }) {
  const nodes = parseSlackMrkdwn(text);
  return (
    <div className="whitespace-pre-wrap break-words text-sm leading-6">
      {nodes.map((node, index) => (
        <SlackMrkdwnPart key={`${node.type}-${index}`} node={node} />
      ))}
    </div>
  );
}

function SlackMrkdwnPart({ node }: { node: SlackMrkdwnNode }) {
  switch (node.type) {
    case "text":
      return node.value;
    case "code":
      return (
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {node.value}
        </code>
      );
    case "codeblock":
      return (
        <pre className="my-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-5">
          {node.value}
        </pre>
      );
    case "bold":
      return <strong className="font-semibold">{node.value}</strong>;
    case "italic":
      return <em>{node.value}</em>;
    case "strike":
      return <s className="text-muted-foreground">{node.value}</s>;
    case "link":
      return (
        <a
          href={node.href}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline-offset-2 hover:underline"
        >
          {node.label}
        </a>
      );
    case "mention":
      return (
        <span className="rounded bg-primary/10 px-1 font-medium text-primary">
          {node.value}
        </span>
      );
  }
}
