import {
  IconMessageCircle,
  IconCopy,
  IconPlus,
  IconDownload,
} from "@tabler/icons-react";
import * as React from "react";

import { Avatar, AvatarFallback } from "../../../src/ui/base-ui/avatar.js";
import { Button, IconButton } from "../../../src/ui/base-ui/button.js";
import {
  ConstraintPicker,
  type ConstraintValue,
} from "../../../src/ui/base-ui/constraint-controls.js";
import {
  DesignPropertySection,
  DesignSelectionProperties,
  type DesignSelectionPropertiesProps,
} from "../../../src/ui/base-ui/design-property-inspector.js";
import { Input } from "../../../src/ui/base-ui/input.js";
import {
  Popover,
  PopoverTrigger,
  PopoverPopup,
  PopoverTitle,
} from "../../../src/ui/base-ui/popover.js";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "../../../src/ui/base-ui/segmented-control.js";
import type {
  LayerGeometry,
  WorkspaceLayer,
} from "./editor-workspace-fixture.js";

import "./workspace-inspector.css";
function Flyout({
  label,
  trigger,
  children,
}: {
  label: string;
  trigger: React.ReactElement;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger render={trigger} />
      <PopoverPopup className="workspace-property-popup" align="end">
        <PopoverTitle>{label}</PopoverTitle>
        {children}
      </PopoverPopup>
    </Popover>
  );
}
function Collaboration() {
  const [comments, setComments] = React.useState([
    "Copy button needs a copied state.",
  ]);
  const [draft, setDraft] = React.useState("");
  const [status, setStatus] = React.useState("");
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setStatus("Copied");
    } catch {
      setStatus("Select the link to copy");
    }
  }
  return (
    <>
      <div className="workspace-collaborators">
        <Flyout
          label="People in this file"
          trigger={
            <button
              className="workspace-avatar-stack"
              aria-label="People in this file"
            >
              {["V", "A", "S"].map((p, i) => (
                <span className="workspace-avatar-member" key={p}>
                  <Avatar
                    color={(["warning", "success", "accent"] as const)[i]}
                    radius="full"
                    variant="solid"
                  >
                    <AvatarFallback>{p}</AvatarFallback>
                  </Avatar>
                </span>
              ))}
            </button>
          }
        >
          {["Vee", "Ana", "Shawn (you)"].map((p) => (
            <div key={p}>{p}</div>
          ))}
        </Flyout>
        <Flyout
          label="Comments"
          trigger={
            <IconButton
              variant="ghost"
              color="gray"
              aria-label="Comments"
              className="workspace-comment-button"
            >
              <IconMessageCircle />
            </IconButton>
          }
        >
          <ul>
            {comments.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft.trim()) return;
              setComments([...comments, draft.trim()]);
              setDraft("");
            }}
          >
            <Input
              aria-label="Write a comment"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <Button disabled={!draft.trim()} type="submit">
              Add comment
            </Button>
          </form>
        </Flyout>
      </div>
      <Flyout
        label="Share"
        trigger={<Button className="workspace-share">Share</Button>}
      >
        <label>
          Story link
          <Input
            readOnly
            value={window.location.href}
            onFocus={(e) => e.target.select()}
          />
        </label>
        <Button onClick={() => void copyLink()}>Copy link</Button>
        <span role="status">{status}</span>
      </Flyout>
    </>
  );
}

type WorkspaceInspectorProps = Omit<
  DesignSelectionPropertiesProps<LayerGeometry>,
  "layers"
> & {
  layers: WorkspaceLayer[];
};
function ExportSelection({
  layers,
  current,
  title,
}: Pick<WorkspaceInspectorProps, "layers" | "current" | "title">) {
  const [open, setOpen] = React.useState(false);
  const exportJSON = () => {
    const link = document.createElement("a");
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            layers.map((layer, i) => ({
              id: layer.id,
              name: layer.name,
              ...current[i],
            })),
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    link.href = url;
    link.download = (title || "selection") + ".json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <DesignPropertySection
      title="Export"
      actions={
        <div className="design-property-inspector-property-actions">
          <IconButton
            variant="ghost"
            color="gray"
            aria-label="Download layer JSON"
            title="Download layer JSON"
            onClick={exportJSON}
          >
            <IconCopy />
          </IconButton>
          <IconButton
            variant="ghost"
            color="gray"
            aria-label="Export settings"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <IconPlus />
          </IconButton>
        </div>
      }
    >
      {open ? (
        <Button variant="surface" onClick={exportJSON}>
          <IconDownload />
          Export {title}.json
        </Button>
      ) : null}
    </DesignPropertySection>
  );
}
const collaboration = <Collaboration />;

export function WorkspaceInspector({
  apply,
  ...props
}: WorkspaceInspectorProps) {
  const nav = props.layers.length === 1 && props.layers[0].sourceId === "nav";
  return (
    <DesignSelectionProperties
      {...props}
      className="workspace-inspector"
      collaboration={collaboration}
      renderPositionAction={({ layers, current, readOnly }) => {
        if (!layers.every((layer) => layer.parentId != null)) return undefined;
        const { horizontal, vertical } = current[0].constraints;
        const value: ConstraintValue = {
          horizontal: current.every(
            (layer) => layer.constraints.horizontal === horizontal,
          )
            ? horizontal
            : "mixed",
          vertical: current.every(
            (layer) => layer.constraints.vertical === vertical,
          )
            ? vertical
            : "mixed",
        };
        return (
          <ConstraintPicker
            value={value}
            disabled={readOnly}
            onChange={(change) =>
              apply((layer) => ({
                ...layer,
                constraints: { ...layer.constraints, ...change },
              }))
            }
          />
        );
      }}
      exportSection={
        <ExportSelection
          layers={props.layers}
          current={props.current}
          title={props.title}
        />
      }
      apply={apply}
      instanceControl={
        nav && (
          <SegmentedControl
            aria-label="Log in"
            value={props.current[0].login ? "On" : "Off"}
            onValueChange={(v) => apply((g) => ({ ...g, login: v === "On" }))}
          >
            {["On", "Off"].map((v) => (
              <SegmentedControlItem value={v} key={v}>
                {v}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        )
      }
    >
      <span className="sr-only" data-testid="selected-count">
        {props.title}
      </span>
    </DesignSelectionProperties>
  );
}
