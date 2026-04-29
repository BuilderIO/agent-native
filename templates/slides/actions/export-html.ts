import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { resolveAccess } from "@agent-native/core/sharing";
import "../server/db/index.js"; // ensure registerShareableResource runs
import {
  type AspectRatio,
  getAspectRatioDims,
  ASPECT_RATIO_VALUES,
} from "../shared/aspect-ratios.js";

function buildStandaloneHtml(
  title: string,
  slides: Array<{ id: string; content: string; notes?: string }>,
  aspectRatio?: AspectRatio,
): string {
  const dims = getAspectRatioDims(aspectRatio);
  const slideHtmlSections = slides
    .map(
      (slide, i) =>
        `<section class="slide" data-index="${i}" style="display: ${i === 0 ? "flex" : "none"};">${slide.content}</section>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    html, body {
      width: 100%; height: 100%;
      background: #111;
      overflow: hidden;
      font-family: 'Poppins', sans-serif;
    }

    .viewport {
      width: 100vw;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
    }

    .slide-container {
      width: ${dims.width}px;
      height: ${dims.height}px;
      position: relative;
      transform-origin: center center;
    }

    .slide {
      width: ${dims.width}px;
      height: ${dims.height}px;
      background: #000;
      overflow: hidden;
      position: absolute;
      top: 0;
      left: 0;
      align-items: stretch;
      justify-content: stretch;
    }

    .slide > * {
      width: 100%;
      height: 100%;
    }

    .fmd-slide {
      width: 100%;
      height: 100%;
      box-sizing: border-box;
    }

    .bottom-bar {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 40px;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 20px;
      font-family: 'Poppins', sans-serif;
      font-size: 13px;
      color: rgba(255, 255, 255, 0.5);
      z-index: 100;
      opacity: 0;
      transition: opacity 0.2s;
    }

    .viewport:hover .bottom-bar,
    .bottom-bar:hover {
      opacity: 1;
    }

    .slide-counter {
      font-variant-numeric: tabular-nums;
    }

    .controls {
      display: flex;
      gap: 16px;
      align-items: center;
    }

    .controls span {
      opacity: 0.6;
    }

    kbd {
      background: rgba(255, 255, 255, 0.1);
      border-radius: 3px;
      padding: 1px 5px;
      font-size: 11px;
      font-family: inherit;
    }
  </style>
</head>
<body>
  <div class="viewport" id="viewport">
    <div class="slide-container" id="slideContainer">
      ${slideHtmlSections}
    </div>
    <div class="bottom-bar">
      <div class="slide-counter" id="counter">1 / ${slides.length}</div>
      <div class="controls">
        <span><kbd>&larr;</kbd> <kbd>&rarr;</kbd> navigate</span>
        <span><kbd>F</kbd> fullscreen</span>
        <span><kbd>Esc</kbd> exit</span>
      </div>
    </div>
  </div>
  <script>
    (function() {
      var currentSlide = 0;
      var totalSlides = ${slides.length};
      var slides = document.querySelectorAll('.slide');
      var counter = document.getElementById('counter');
      var container = document.getElementById('slideContainer');

      function showSlide(index) {
        if (index < 0 || index >= totalSlides) return;
        slides[currentSlide].style.display = 'none';
        currentSlide = index;
        slides[currentSlide].style.display = 'flex';
        counter.textContent = (currentSlide + 1) + ' / ' + totalSlides;
      }

      function fitSlide() {
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var scale = Math.min(vw / ${dims.width}, vh / ${dims.height});
        container.style.transform = 'scale(' + scale + ')';
      }

      window.addEventListener('resize', fitSlide);
      fitSlide();

      document.addEventListener('keydown', function(e) {
        switch (e.key) {
          case 'ArrowRight':
          case 'ArrowDown':
          case ' ':
            e.preventDefault();
            showSlide(currentSlide + 1);
            break;
          case 'ArrowLeft':
          case 'ArrowUp':
            e.preventDefault();
            showSlide(currentSlide - 1);
            break;
          case 'Home':
            e.preventDefault();
            showSlide(0);
            break;
          case 'End':
            e.preventDefault();
            showSlide(totalSlides - 1);
            break;
          case 'f':
          case 'F':
            if (!document.fullscreenElement) {
              document.documentElement.requestFullscreen().catch(function() {});
            } else {
              document.exitFullscreen().catch(function() {});
            }
            break;
          case 'Escape':
            if (document.fullscreenElement) {
              document.exitFullscreen().catch(function() {});
            }
            break;
        }
      });

      // Click to advance (left third = back, right two-thirds = forward)
      document.getElementById('viewport').addEventListener('click', function(e) {
        if (e.target.closest('.bottom-bar')) return;
        var rect = this.getBoundingClientRect();
        var x = e.clientX - rect.left;
        if (x < rect.width / 3) {
          showSlide(currentSlide - 1);
        } else {
          showSlide(currentSlide + 1);
        }
      });
    })();
  </script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default defineAction({
  description:
    "Export a deck as a standalone HTML file with built-in keyboard navigation. Returns a download URL for the generated file.",
  schema: z.object({
    deckId: z.string().describe("Deck ID to export"),
  }),
  run: async ({ deckId }) => {
    const access = await resolveAccess("deck", deckId);
    if (!access) throw new Error(`Deck not found: ${deckId}`);

    const row = access.resource;
    const deckData = JSON.parse(row.data);
    const slides = deckData.slides || [];
    const rawAspectRatio = deckData.aspectRatio;
    const aspectRatio: AspectRatio | undefined = ASPECT_RATIO_VALUES.includes(
      rawAspectRatio,
    )
      ? rawAspectRatio
      : undefined;

    if (slides.length === 0) {
      return { error: "Cannot export empty deck" };
    }

    const html = buildStandaloneHtml(row.title, slides, aspectRatio);

    // Save to exports directory
    const fs = await import("fs");
    const path = await import("path");
    const exportDir = path.join(process.cwd(), "data", "exports");
    fs.mkdirSync(exportDir, { recursive: true });
    const filename = `${row.title.replace(/[^a-zA-Z0-9]/g, "-")}-${Date.now()}.html`;
    const filePath = path.join(exportDir, filename);
    fs.writeFileSync(filePath, html);

    return { filePath, filename, slideCount: slides.length };
  },
});
