# Spicy Chicken Preview

A native macOS image viewer built with Tauri 2 + React 19 + TypeScript. Minimal, fast, and keyboard-driven.

## Features

- **Image viewing** — Open individual images or browse entire folders, rendered via Canvas with Retina display support
- **Sidebar thumbnail list** — Browse all images in a folder with lazy-loaded thumbnails
- **Zoom & pan** — Pinch-to-zoom, mouse wheel zoom, drag to pan, double-click to toggle fullscreen
- **Fullscreen mode** — Immersive fullscreen with auto-hiding bottom thumbnail strip
- **Slideshow** — Auto-advance with configurable interval (2s / 3s / 5s / 10s) and crossfade transitions
- **Image preloading** — Adjacent images preloaded in background for instant navigation
- **Sorting** — Sort by name, dimensions, aspect ratio, or modification date, ascending or descending
- **Status bar** — Shows image dimensions, file size, format, and current zoom level
- **Drag & drop** — Drag files directly from Finder into the window
- **Theme** — Dark and light themes
- **i18n** — English / Chinese language support
- **Recent folders** — Quick access to recently opened folders, persisted across restarts
- **Responsive toolbar** — Toolbar items collapse into an overflow menu on narrow windows, with hover expansion
- **File associations** — Opens jpg, jpeg, png, gif, webp, bmp, svg, avif, tiff, tif

## Keyboard Shortcuts

| Key | Action |
| --- | --- |
| ← / → | Previous / next image |
| Space | Toggle slideshow |
| F | Toggle fullscreen |
| Ctrl/Cmd + =/+ | Zoom in |
| Ctrl/Cmd + - | Zoom out |
| Ctrl/Cmd + 0 | Reset zoom |
| Ctrl/Cmd + B | Toggle sidebar |

## Development

```bash
pnpm install
pnpm run dev
```

Built with [Tauri](https://tauri.app/) + [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/).
