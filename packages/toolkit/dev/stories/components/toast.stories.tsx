import {
  COLORS,
  type ToastOwnProps,
  toastProps,
} from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";

import { Button } from "../../../src/ui/base-ui/button.js";
import {
  Toaster,
  type ToasterProps,
  type ToastOptions,
  toast,
  useToastAnchor,
} from "../../../src/ui/base-ui/toast.js";
import { propControls } from "../prop-controls.js";
import guide from "./toast.docs.md?raw";

const controls = propControls(toastProps);

const VARIANTS = toastProps.variant.values;

type ToastArgs = ToasterProps &
  ToastOwnProps & {
    title: string;
    description?: string;
  };

function fromArgs({
  variant,
  color,
  highContrast,
  title,
  description,
}: ToastArgs): ToastOptions {
  return { variant, color, highContrast, title, description };
}

const meta = {
  title: "Components/Toast",
  component: Toaster,
  parameters: {
    layout: "padded",
    docs: {
      description: { component: guide },
      story: { inline: false, iframeHeight: 360 },
    },
  },
  args: {
    ...controls.args,
    closeLabel: "Dismiss",
    regionLabel: "Notifications",
    title: "Changes saved",
    description: "Your design is up to date.",
  },
  argTypes: controls.argTypes,
  decorators: [
    (Story, { args }) => (
      <>
        <Story />
        <Toaster closeLabel={args.closeLabel} regionLabel={args.regionLabel} />
      </>
    ),
  ],
} satisfies Meta<ToastArgs>;

export default meta;

type Story = StoryObj<typeof meta>;
type StoryArgs = Parameters<NonNullable<Story["render"]>>[0];

/** A toast with the props from the controls. */
export const Playground: Story = {
  render: (args) => (
    <div>
      <Button onClick={() => toast.add(fromArgs(args))}>Show toast</Button>
    </div>
  ),
};

/** A toast in each color. Unset is neutral, drawn in gray. */
export const Colors: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="soft"
        color="gray"
        onClick={() => toast.add({ ...fromArgs(args), color: undefined })}
      >
        unset
      </Button>
      {COLORS.map((color) => (
        <Button
          key={color}
          variant="soft"
          color={color}
          onClick={() =>
            toast.add({ ...fromArgs(args), color, title: `A ${color} toast` })
          }
        >
          {color}
        </Button>
      ))}
    </div>
  ),
};

/** Every variant, then in high contrast, in the color from the controls. */
export const Variants: Story = {
  args: { color: "success" },
  render: (args) => (
    <div className="flex flex-col gap-3">
      {[false, true].map((highContrast) => (
        <div key={String(highContrast)} className="flex items-center gap-3">
          {VARIANTS.map((variant) => (
            <Button
              key={variant}
              variant="soft"
              color="gray"
              onClick={() =>
                toast.add({ ...fromArgs(args), variant, highContrast })
              }
            >
              {variant}
              {highContrast ? ", high contrast" : ""}
            </Button>
          ))}
        </div>
      ))}
    </div>
  ),
};

function settle(succeed: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    setTimeout(
      () => (succeed ? resolve("homepage") : reject(new Error("offline"))),
      2000,
    );
  });
}

/** A Spinner while the promise runs, then its success or error state. */
export const Promise_: Story = {
  name: "Promise",
  render: () => {
    const run = (succeed: boolean) =>
      toast
        .promise(settle(succeed), {
          loading: { title: "Publishing" },
          success: (page) => ({
            title: "Published",
            description: `The ${page} is live.`,
          }),
          error: (error) => ({
            title: "Couldn't publish",
            description: error instanceof Error ? error.message : undefined,
          }),
        })
        .catch(() => undefined);
    return (
      <div className="flex items-center gap-3">
        <Button onClick={() => void run(true)}>Publish</Button>
        <Button variant="soft" color="gray" onClick={() => void run(false)}>
          Publish, failing
        </Button>
      </div>
    );
  },
};

/** An action that answers the toast, and a second one before it. */
export const WithAction: Story = {
  name: "With action",
  render: (args) => {
    const remove = () => {
      const id = toast.add({
        ...fromArgs(args),
        title: "Layer deleted",
        description: undefined,
        actionProps: {
          children: "Undo",
          onClick: () => {
            toast.close(id);
            toast.add({ title: "Layer restored" });
          },
        },
      });
    };
    const offer = () => {
      const id = toast.add({
        ...fromArgs(args),
        title: "A new version is ready",
        description: "Reload to update.",
        actionProps: { children: "Reload", onClick: () => toast.close(id) },
        secondaryActionProps: {
          children: "Not now",
          onClick: () => toast.close(id),
        },
      });
    };
    return (
      <div className="flex items-center gap-3">
        <Button onClick={remove}>Delete layer</Button>
        <Button variant="soft" color="gray" onClick={offer}>
          Offer an update
        </Button>
      </div>
    );
  },
};

/** Several at once stack; hover or focus the stack (F6) to fan it out. */
export const Stacked: Story = {
  render: (args) => (
    <div>
      <Button
        onClick={() => {
          toast.add({
            ...fromArgs(args),
            title: "Export started",
            color: "info",
          });
          toast.add({
            ...fromArgs(args),
            title: "Two files skipped",
            color: "warning",
          });
          toast.add({
            ...fromArgs(args),
            title: "Export finished",
            color: "success",
          });
        }}
      >
        Show three toasts
      </Button>
    </div>
  ),
};

/** Focus on something under the stack, and the stack steps aside until focus moves on. */
export const StepsAsideForFocus: Story = {
  name: "Steps aside for focus",
  render: (args) => (
    <div>
      <Button
        onClick={() =>
          toast.add({
            ...fromArgs(args),
            title: "Comment posted",
            color: "danger",
          })
        }
      >
        Show a toast
      </Button>
      <div className="fixed right-6 bottom-6">
        <Button variant="soft" color="gray">
          Under the stack
        </Button>
      </div>
    </div>
  ),
};

const TOOLS = ["Move", "Frame", "Text", "Pen", "Shape", "Comment"];

function MockEditor({ wide }: { wide: boolean }) {
  const anchor = useToastAnchor<HTMLDivElement>();
  return (
    <div
      className={`fixed top-24 bottom-4 left-4 flex border border-line-default ${
        wide ? "right-4" : "w-[960px]"
      }`}
    >
      <div className="w-56 shrink-0 border-r border-line-default bg-surface-raised" />
      <div
        ref={anchor}
        className="relative min-w-0 flex-1 bg-surface-canvas [--toast-inset-bottom:48px]"
      >
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-1 rounded-full bg-surface-raised p-1 shadow-md">
          {TOOLS.map((tool) => (
            <Button key={tool} size="md" variant="ghost" color="gray">
              {tool}
            </Button>
          ))}
        </div>
      </div>
      <div className="w-72 shrink-0 border-l border-line-default bg-surface-raised" />
    </div>
  );
}

function AnchoredInACanvasStory(args: StoryArgs) {
  const [wide, setWide] = React.useState(true);
  return (
    <div className="flex items-center gap-3">
      <Button variant={wide ? "solid" : "soft"} onClick={() => setWide(true)}>
        Wide canvas
      </Button>
      <Button variant={wide ? "soft" : "solid"} onClick={() => setWide(false)}>
        Narrow canvas
      </Button>
      <Button
        variant="soft"
        color="gray"
        onClick={() =>
          toast.add({
            ...fromArgs(args),
            title: "Couldn't place the image",
            description: "The file is over 20 MB.",
            color: "danger",
          })
        }
      >
        Show a toast
      </Button>
      <MockEditor wide={wide} />
    </div>
  );
}
/**
 * Toasts sit at the bottom right of the canvas, clear of the side panels.
 * A canvas 1200px or wider keeps them on the toolbar's baseline; a narrower
 * one lifts them over it by the canvas's `--toast-inset-bottom`. The wide
 * canvas fills the frame, so open this story in a wide window.
 */
export const AnchoredInACanvas: Story = {
  name: "Anchored in a canvas",
  parameters: { docs: { story: { inline: false, iframeHeight: 600 } } },
  render: (args) => <AnchoredInACanvasStory {...args} />,
};
