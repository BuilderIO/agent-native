import type {
  PlanWireframeElName,
  PlanWireframeNode,
} from "@shared/plan-content";
import { type ReactNode } from "react";

import {
  Avatar,
  Bar,
  Box,
  BrowserBar,
  Btn,
  Card,
  Check,
  Chip,
  Col,
  Column,
  Divider,
  Field,
  Fab,
  Hand,
  IconSquare,
  KV,
  Lines,
  Main,
  NavItem,
  Pill,
  Row,
  Screen,
  SearchBar,
  SectionLabel,
  Sidebar,
  StatusBar,
  Tabs,
  TaskRow,
  Text,
  Title,
  Toolbar,
} from "./primitives";

type NodeRenderer = (node: PlanWireframeNode, children: ReactNode) => ReactNode;

const REGISTRY: Record<PlanWireframeElName, NodeRenderer> = {
  screen: (n) => {
    const kids = n.children ?? [];
    const lead = kids[0]?.el;
    if (lead === "browserBar") {
      return (
        <Screen pad={0}>
          {renderNode(kids[0], kids[0].id ?? "browserbar")}
          {renderScreenBodyNodes(kids.slice(1))}
        </Screen>
      );
    }
    if (lead === "statusBar") {
      return (
        <Screen pad={0}>
          {renderNode(kids[0], kids[0].id ?? "statusbar")}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              gap: "var(--gap)",
              padding: "calc(var(--pad) * 1.1)",
            }}
          >
            {renderScreenBodyNodes(kids.slice(1))}
          </div>
        </Screen>
      );
    }
    return (
      <Screen pad="calc(var(--pad) * 1.35)">
        {renderScreenBodyNodes(kids)}
      </Screen>
    );
  },
  browserBar: (n, children) => (
    <BrowserBar title={n.title ?? n.text}>{children}</BrowserBar>
  ),
  statusBar: () => <StatusBar />,
  toolbar: (_n, children) => <Toolbar>{children}</Toolbar>,
  row: (n, children) => <Row full={n.full}>{children}</Row>,
  col: (n, children) => <Col full={n.full}>{children}</Col>,
  sidebar: (_n, children) => <Sidebar>{children}</Sidebar>,
  main: (_n, children) => <Main>{children}</Main>,
  box: (n, children) => <Box dashed={n.dashed}>{children}</Box>,
  card: (_n, children) => <Card>{children}</Card>,
  column: (n, children) => (
    <Column title={n.title ?? n.text} count={n.count} tone={n.tone}>
      {children}
    </Column>
  ),
  divider: () => <Divider />,

  title: (n) => <Title text={n.text} script={n.script} />,
  text: (n) => (
    <Text
      value={n.value ?? n.text}
      color={n.color}
      weight={n.weight}
      script={n.script}
    />
  ),
  lines: (n) => <Lines n={n.n} widths={n.widths} />,
  section: (n) => (
    <SectionLabel tone={n.tone}>{n.label ?? n.text}</SectionLabel>
  ),

  navItem: (n) => (
    <NavItem
      label={n.label ?? n.text}
      count={n.count}
      active={n.active}
      dot={n.dot}
      tone={n.tone}
    />
  ),
  taskRow: (n) => (
    <TaskRow
      title={n.title ?? n.text}
      note={n.note}
      due={n.due}
      dueTone={n.dueTone}
      prio={n.prio}
      done={n.done}
    />
  ),

  chips: (n) => <Tabs items={n.items ?? []} />,
  chip: (n) => <Chip active={n.active}>{n.label ?? n.text}</Chip>,
  pill: (n) => <Pill tone={n.tone}>{n.label ?? n.text}</Pill>,
  check: (n) => <Check done={n.done} shape={n.shape} />,
  field: (n) => (
    <Field
      label={n.label}
      value={n.value}
      placeholder={n.placeholder}
      area={n.area}
    />
  ),
  btn: (n) => (
    <Btn solid={n.solid} full={n.full} tone={n.tone}>
      {n.label ?? n.text}
    </Btn>
  ),
  fab: (n) => <Fab icon={n.icon} />,
  searchBar: (n) => <SearchBar placeholder={n.placeholder} />,

  avatar: () => <Avatar />,
  iconSquare: (n) => <IconSquare active={n.active} />,
  kv: (n) => <KV rows={n.rows ?? []} />,
};

function renderScreenBodyNode(
  node: PlanWireframeNode,
  key?: string | number,
): ReactNode {
  const shouldFill =
    node.full !== false &&
    (node.el === "row" || node.el === "col" || node.el === "main");
  return renderNode(shouldFill ? { ...node, full: true } : node, key);
}

function renderScreenBodyNodes(nodes: PlanWireframeNode[]): ReactNode {
  return nodes.map((node, i) =>
    renderScreenBodyNode(node, node.id ?? `screen-body-${i}`),
  );
}

export function renderNode(
  node: PlanWireframeNode,
  key?: string | number,
): ReactNode {
  const renderer = REGISTRY[node.el];
  const children = node.children?.length ? renderNodes(node.children) : null;
  if (!renderer) {
    return children ? <div key={key}>{children}</div> : null;
  }
  let rendered = renderer(node, children);
  if (node.id && rendered != null) {
    rendered = (
      <div
        style={{ display: "contents" }}
        data-wire-node-id={node.id}
        data-wire-node-el={node.el}
      >
        {rendered}
      </div>
    );
  }
  return <KeyedNode key={key ?? node.id}>{rendered}</KeyedNode>;
}

export function renderNodes(nodes: PlanWireframeNode[]): ReactNode {
  return nodes.map((node, i) => renderNode(node, node.id ?? i));
}

function KeyedNode({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function hasRenderer(el: string): el is PlanWireframeElName {
  return el in REGISTRY;
}

export { REGISTRY as NODE_REGISTRY };
