import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { AnnouncementPreview, featureUrl } from "./announcement-preview.js";
import guide from "./announcement.docs.md?raw";

const meta = {
  title: "Patterns/Announcement",
  parameters: { docs: { description: { component: guide } } },
  component: AnnouncementPreview,
  argTypes: {
    featureHref: { control: "text" },
    media: { control: "inline-radio", options: ["image", "video", "none"] },
  },
  args: {
    media: "image",
    featureHref: featureUrl,
  },
} satisfies Meta<typeof AnnouncementPreview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Card: Story = {};
export const ImageDialog: Story = {
  play: async ({ args, canvas, userEvent }) => {
    const checkArtwork = async (image: HTMLImageElement) => {
      await image.decode();
      const frame = image.closest<HTMLElement>(
        ".image-card-media, .dialog-media",
      );
      if (!frame) throw new Error("Missing media frame");
      await expect(image.clientWidth).toBe(frame.clientWidth);
      await expect(image.clientHeight).toBe(frame.clientHeight);
    };
    const cardImage = canvas.getByRole<HTMLImageElement>("img");
    await checkArtwork(cardImage);
    const trigger = canvas.getByRole("button", {
      name: "Meet the style library",
    });
    const pointerTarget = (element: Element) => {
      element.scrollIntoView({ block: "nearest" });
      const { left, top, width, height } = element.getBoundingClientRect();
      return element.ownerDocument.elementFromPoint(
        left + width / 2,
        top + height / 2,
      );
    };
    const cardLink = canvas.getByRole("link", {
      name: "Explore styles (opens in a new tab)",
    });
    await expect(pointerTarget(cardImage)).toBe(trigger);
    await expect(cardLink.contains(pointerTarget(cardLink))).toBe(true);
    await expect(cardLink).toHaveAttribute("href", args.featureHref);
    await expect(cardLink).toHaveAttribute("target", "_blank");
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    const dialog = await canvas.findByRole("dialog", {
      name: "Meet the style library",
    });
    await checkArtwork(within(dialog).getByRole<HTMLImageElement>("img"));
    await expect(
      within(dialog).getByRole("link", {
        name: "Explore styles (opens in a new tab)",
      }),
    ).toHaveAttribute("href", args.featureHref);
    await expect(within(dialog).getByRole("link")).toHaveAttribute(
      "target",
      "_blank",
    );
    await expect(dialog.querySelector("header")).toContainElement(
      within(dialog).getByRole("heading", { name: "Meet the style library" }),
    );
    await expect(dialog.querySelector("footer")).toContainElement(
      within(dialog).getByRole("link", {
        name: "Explore styles (opens in a new tab)",
      }),
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    await userEvent.click(trigger);
  },
};
export const VideoDialog: Story = {
  args: { media: "video" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const trigger = canvas.getByRole("button", {
      name: "Meet the style library",
    });
    await expect(canvasElement.querySelector("video")).toBeNull();
    await userEvent.click(trigger);
    const dialog = await canvas.findByRole("dialog", {
      name: "Meet the style library",
    });
    const video =
      within(dialog).getByLabelText<HTMLVideoElement>(/Paper studies/);
    await expect(video.paused).toBe(true);
    await video.play();
    await waitFor(() => expect(video.currentTime).toBeGreaterThan(0.25));
    const feature = within(dialog).getByRole("link", {
      name: "Explore styles (opens in a new tab)",
    });
    feature.addEventListener("click", (event) => event.preventDefault(), {
      once: true,
    });
    feature.focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(trigger).toHaveFocus());
    await expect(video.paused).toBe(true);
    await waitFor(() => expect(video.seeking).toBe(false));
    const position = video.currentTime;
    await userEvent.click(trigger);
    const reopened = await canvas.findByRole("dialog", {
      name: "Meet the style library",
    });
    await expect(within(reopened).getByLabelText(/Paper studies/)).toBe(video);
    await waitFor(() => expect(video.currentTime).toBeCloseTo(position, 2));
    await expect(video.paused).toBe(true);
  },
};
export const TextOnly: Story = {
  args: { media: "none" },
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", {
      name: "Meet the style library",
    });
    const link = canvas.getByRole("link", {
      name: "Explore styles (opens in a new tab)",
    });
    trigger.focus();
    await userEvent.tab();
    await expect(link).toHaveFocus();
    await userEvent.tab({ shift: true });
    await userEvent.keyboard(" ");
    const dialog = await canvas.findByRole("dialog", {
      name: "Meet the style library",
    });
    await expect(within(dialog).queryByRole("img")).toBeNull();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Maybe later" }),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
    await userEvent.keyboard("{Enter}");
    const reopened = await canvas.findByRole("dialog", {
      name: "Meet the style library",
    });
    await userEvent.click(
      within(reopened).getByRole("button", { name: "Close announcement" }),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};
