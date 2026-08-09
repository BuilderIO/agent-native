---
type: fixed
date: 2026-08-09
---

Fixed decks with many slides loading slowly and rendering incorrectly in the editor. Every slide thumbnail measured its full layout on mount, so a long deck forced hundreds of page reflows at once; off-screen thumbnails now wait until they scroll into view.
