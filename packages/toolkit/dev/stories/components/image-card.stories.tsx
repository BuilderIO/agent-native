import { cardProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { AspectRatio } from "../../../src/ui/base-ui/aspect-ratio.js";
import { Button, ButtonLink } from "../../../src/ui/base-ui/button.js";
import { Heading } from "../../../src/ui/base-ui/heading.js";
import {
  ImageCard,
  ImageCardActions,
  ImageCardBody,
  ImageCardMedia,
  ImageCardTarget,
} from "../../../src/ui/base-ui/image-card.js";
import { Inset } from "../../../src/ui/base-ui/inset.js";
import { Link } from "../../../src/ui/base-ui/link.js";
import { Text } from "../../../src/ui/base-ui/text.js";
import { propControls } from "../prop-controls.js";
import guide from "./image-card.docs.md?raw";

const cover = new URL(
  "../../../../../templates/assets/public/library-presets/prismatic-paper-cut/kirigami.webp",
  import.meta.url,
).href;
const artwork = (
  <ImageCardMedia>
    <img
      src={cover}
      alt="Layered paper steps in blue and chartreuse"
      decoding="async"
      width={800}
      height={400}
    />
  </ImageCardMedia>
);
const controls = propControls(cardProps);
const meta = {
  title: "Components/Image Card",
  parameters: { docs: { description: { component: guide } } },
  component: ImageCard,
  args: controls.args,
  argTypes: controls.argTypes,
  decorators: [
    (Story) => (
      <div className="max-w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ImageCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {
  render: (args) => (
    <ImageCard {...args}>
      {artwork}
      <ImageCardBody>
        <Heading as="h2" textStyle="title-small">
          Paper studies
        </Heading>
        <Text as="p" textStyle="body" className="text-fg-muted">
          A collection of folded forms.
        </Text>
        <ImageCardActions>
          <Link href="https://assets.agent-native.com/library">
            Open library
          </Link>
        </ImageCardActions>
      </ImageCardBody>
    </ImageCard>
  ),
};
export const NarrowActions: Story = {
  render: (args) => (
    <div style={{ maxInlineSize: "12rem" }}>
      <ImageCard {...args}>
        {artwork}
        <ImageCardBody>
          <Heading as="h2" textStyle="title-small">
            <ImageCardTarget>Paper studies</ImageCardTarget>
          </Heading>
          <ImageCardActions>
            <ButtonLink href="https://assets.agent-native.com/library">
              Open this collection in the shared style library
            </ButtonLink>
          </ImageCardActions>
        </ImageCardBody>
      </ImageCard>
    </div>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "Paper studies" });
    const link = canvas.getByRole("link");
    const actions = link.parentElement;
    if (!actions) throw new Error("Missing card actions");
    const card = actions.closest(".image-card");
    if (!card) throw new Error("Missing image card");
    await expect(link.getBoundingClientRect().right).toBeLessThanOrEqual(
      card.getBoundingClientRect().right,
    );
    await expect(link.offsetWidth).toBeLessThanOrEqual(actions.clientWidth);
    await expect(link.scrollWidth).toBeLessThanOrEqual(link.clientWidth + 1);
    await expect(link.offsetHeight).toBeGreaterThan(
      parseFloat(getComputedStyle(link).lineHeight) * 2,
    );
    trigger.focus();
    await userEvent.tab();
    await expect(link).toHaveFocus();
  },
};

export const GroupedActions: Story = {
  render: (args) => (
    <ImageCard {...args}>
      {artwork}
      <ImageCardBody>
        <Heading as="h2" textStyle="title-small">
          <ImageCardTarget render={<Button variant="ghost" />}>
            Paper studies
          </ImageCardTarget>
        </Heading>
        <ImageCardActions>
          <div className="flex items-center gap-2">
            <div style={{ display: "contents" }}>
              <Link href="#paper-collection">Open collection</Link>
              <Link href="#paper-artist">View artist</Link>
            </div>
          </div>
        </ImageCardActions>
      </ImageCardBody>
    </ImageCard>
  ),
  play: async ({ canvas, userEvent }) => {
    const target = canvas.getByRole("button", { name: "Paper studies" });
    const coverBox = canvas.getByRole("img").getBoundingClientRect();
    await expect(
      target.ownerDocument.elementFromPoint(
        coverBox.left + coverBox.width / 2,
        coverBox.top + coverBox.height / 2,
      ),
    ).toBe(target);
    target.focus();
    const links = canvas.getAllByRole("link");
    for (const link of links) {
      await userEvent.tab();
      await expect(link).toHaveFocus();
      const box = link.getBoundingClientRect();
      const hit = link.ownerDocument.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2,
      );
      await expect(link.contains(hit)).toBe(true);
    }
    const first = links[0].getBoundingClientRect();
    const second = links[1].getBoundingClientRect();
    const gap = target.ownerDocument.elementFromPoint(
      (first.right + second.left) / 2,
      first.top + first.height / 2,
    );
    await expect(gap).toBe(target);
  },
};

export const FullBleed: Story = {
  render: (args) => (
    <ImageCard {...args}>
      <Inset side="top">{artwork}</Inset>
      <ImageCardBody>
        <Heading as="h2" textStyle="title-small">
          <ImageCardTarget
            render={<a href="https://assets.agent-native.com/library" />}
          >
            Paper studies
          </ImageCardTarget>
        </Heading>
        <Text as="p" textStyle="body" className="text-fg-muted">
          A collection of folded forms.
        </Text>
      </ImageCardBody>
    </ImageCard>
  ),
};
export const PortraitCover: Story = {
  render: (args) => (
    <ImageCard {...args}>
      <ImageCardMedia render={<AspectRatio ratio={3 / 4} />}>
        <img
          src={
            new URL(
              "../../../../../templates/assets/public/library-presets/storybook-pastoral/watercolor-bridge.webp",
              import.meta.url,
            ).href
          }
          alt="Watercolor bridge"
          width={721}
          height={900}
        />
      </ImageCardMedia>
      <ImageCardBody>
        <Heading as="h2" textStyle="title-small">
          Watercolor studies
        </Heading>
      </ImageCardBody>
    </ImageCard>
  ),
  play: async ({ canvas }) => {
    const image = canvas.getByRole<HTMLImageElement>("img");
    await image.decode();
    const frame = image.parentElement;
    if (!frame) throw new Error("Missing media frame");
    await expect(frame.clientWidth / frame.clientHeight).toBeCloseTo(3 / 4, 2);
    await expect(image.clientHeight).toBe(frame.clientHeight);
    await expect(image.clientWidth).toBe(frame.clientWidth);
  },
};

export const MediaAndTitle: Story = {
  render: (args) => (
    <ImageCard {...args}>
      {artwork}
      <ImageCardBody>
        <Heading as="h2" textStyle="title-small">
          Paper studies
        </Heading>
      </ImageCardBody>
    </ImageCard>
  ),
};

export const VideoWithTarget: Story = {
  render: (args) => (
    <ImageCard {...args}>
      <ImageCardMedia
        render={
          <video
            controls
            playsInline
            preload="none"
            poster={cover}
            aria-label="Paper studies, a silent film"
            src={
              new URL("../patterns/media/paper-studies.mp4", import.meta.url)
                .href
            }
          />
        }
      />
      <ImageCardBody>
        <Heading as="h2" textStyle="title-small">
          <ImageCardTarget
            render={<a href="https://assets.agent-native.com/library" />}
          >
            Paper studies
          </ImageCardTarget>
        </Heading>
      </ImageCardBody>
    </ImageCard>
  ),
  play: async ({ canvas }) => {
    const video = canvas.getByLabelText("Paper studies, a silent film");
    video.scrollIntoView({ block: "center" });
    const bounds = video.getBoundingClientRect();
    const hit = video.ownerDocument.elementFromPoint(
      bounds.x + bounds.width / 2,
      bounds.bottom - 12,
    );
    await expect(hit).toBe(video);
    await expect(
      canvas.getByRole("link", { name: "Paper studies" }),
    ).toHaveAttribute("href", "https://assets.agent-native.com/library");
  },
};
