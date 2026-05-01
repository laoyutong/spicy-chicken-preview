import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open } from "@tauri-apps/plugin-dialog";
import Sidebar, { MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, DEFAULT_SIDEBAR_WIDTH } from "./Sidebar";
import FullscreenStrip from "./FullscreenStrip";
import { loadLanguage, t, translate, type Language } from "./i18n";
import { Toolbar, type ToolbarItemDef } from "./Toolbar";
import { LRUImageCache } from "./lruImageCache";
import SettingsModal from "./SettingsModal";
import "./App.css";
import "./Toolbar.css";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 10;
const ZOOM_STEP = 0.1;
const PAN_DEAD_ZONE = 3;

function loadTheme(): "dark" | "light" {
  try {
    const stored = localStorage.getItem("theme");
    if (stored === "light" || stored === "dark") return stored;
  } catch { /* localStorage unavailable */ }
  return "dark";
}

function loadSidebarWidth(): number {
  try {
    const stored = localStorage.getItem("sidebar-width");
    if (stored) {
      const v = parseInt(stored, 10);
      if (v >= MIN_SIDEBAR_WIDTH && v <= MAX_SIDEBAR_WIDTH) return v;
    }
  } catch { /* localStorage unavailable */ }
  return DEFAULT_SIDEBAR_WIDTH;
}

function getFittedSize(
  imgW: number, imgH: number, cw: number, ch: number,
): { fw: number; fh: number } {
  if (imgW <= 0 || imgH <= 0) return { fw: cw, fh: ch };
  const imgAspect = imgW / imgH;
  const containerAspect = cw / ch;
  if (imgAspect > containerAspect) {
    return { fw: cw, fh: cw / imgAspect };
  }
  return { fw: ch * imgAspect, fh: ch };
}

interface SubdirInfo {
  name: string;
  path: string;
}

interface ImageMeta {
  path: string;
  size: number;
  extension: string;
  modified: number;
}

type SortMode = "name" | "dimensions" | "aspect-ratio" | "modified";

interface ImageMetaRecord {
  size: number;
  extension: string;
  modified: number;
  width?: number;
  height?: number;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function comparePaths(
  a: string, b: string,
  mode: SortMode, order: "asc" | "desc",
  metaMap: Map<string, ImageMetaRecord>,
): number {
  const sign = order === "asc" ? 1 : -1;
  const metaA = metaMap.get(a);
  const metaB = metaMap.get(b);

  switch (mode) {
    case "name": {
      const na = a.split(/[/\\]/).pop()?.toLowerCase() || a;
      const nb = b.split(/[/\\]/).pop()?.toLowerCase() || b;
      return na.localeCompare(nb) * sign;
    }
    case "dimensions": {
      const areaA = (metaA?.width ?? 0) * (metaA?.height ?? 0);
      const areaB = (metaB?.width ?? 0) * (metaB?.height ?? 0);
      return (areaA - areaB) * sign;
    }
    case "aspect-ratio": {
      const ra = metaA?.width && metaA?.height ? metaA.width / metaA.height : 0;
      const rb = metaB?.width && metaB?.height ? metaB.width / metaB.height : 0;
      return (ra - rb) * sign;
    }
    case "modified": {
      const ma = metaA?.modified ?? 0;
      const mb = metaB?.modified ?? 0;
      return (ma - mb) * sign;
    }
    default:
      return 0;
  }
}

function sortImagePaths(
  paths: string[],
  mode: SortMode, order: "asc" | "desc",
  metaMap: Map<string, ImageMetaRecord>,
): string[] {
  return [...paths].sort((a, b) => comparePaths(a, b, mode, order, metaMap));
}

function clampPan(
  px: number, py: number, zoomVal: number,
  imgW: number, imgH: number, cw: number, ch: number,
): { x: number; y: number } {
  if (imgW <= 0 || imgH <= 0 || cw <= 0 || ch <= 0) return { x: 0, y: 0 };
  const { fw, fh } = getFittedSize(imgW, imgH, cw, ch);
  const sw = fw * zoomVal;
  const sh = fh * zoomVal;
  const maxX = Math.abs(sw - cw) / 2;
  const maxY = Math.abs(sh - ch) / 2;
  return {
    x: Math.max(-maxX, Math.min(maxX, px)),
    y: Math.max(-maxY, Math.min(maxY, py)),
  };
}
function App() {
  const [images, setImages] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [subdirs, setSubdirs] = useState<SubdirInfo[]>([]);
  const [recentFolders, setRecentFolders] = useState<SubdirInfo[]>(() => {
    try {
      const stored = localStorage.getItem("recent-folders");
      if (stored) return JSON.parse(stored);
    } catch { /* localStorage unavailable */ }
    return [];
  });
  const [theme, setTheme] = useState<"dark" | "light">(loadTheme);
  const [language, setLanguage] = useState<Language>(loadLanguage);
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  const [isImmersive, setIsImmersive] = useState(false);
  const [slideshowActive, setSlideshowActive] = useState(false);
  const [slideshowInterval, setSlideshowInterval] = useState(3);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const [loading, setLoading] = useState(false);

  // Image preload cache with LRU eviction (capped at ~12 images / ~300MB)
  const imageCache = useRef<LRUImageCache>(new LRUImageCache());

  // Zoom & pan
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [dragging, setDragging] = useState(false);

  // File info for status bar
  const [imageDimensions, setImageDimensions] = useState<{ w: number; h: number } | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [fileFormat, setFileFormat] = useState<string | null>(null);

  // Sorting
  const [sortBy, setSortBy] = useState<SortMode>("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const imageMetaMapRef = useRef<Map<string, ImageMetaRecord>>(new Map());
  const [metaVersion, setMetaVersion] = useState(0);
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const sortDropdownRef = useRef<HTMLDivElement>(null);
  const breadcrumbRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const zoomRef = useRef(zoom);
  const panXRef = useRef(panX);
  const panYRef = useRef(panY);
  const imgW = useRef(0);
  const imgH = useRef(0);
  const sourceImg = useRef<HTMLImageElement | null>(null);
  const isPanning = useRef(false);
  const hasPanned = useRef(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const velocitySamples = useRef<{ x: number; y: number; t: number }[]>([]);
  const momentumRaf = useRef(0);
  const loadGen = useRef(0);
  const loadDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadDebounceStartRef = useRef(0);
  const loadStartTimeRef = useRef(0);
  const imageAreaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fullscreenTransitioningRef = useRef(false);

  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panXRef.current = panX; }, [panX]);
  useEffect(() => { panYRef.current = panY; }, [panY]);

  // Refs for slideshow auto-advance (avoid stale closures in setInterval)
  const imagesRef = useRef(images);
  useEffect(() => { imagesRef.current = images; }, [images]);
  const currentIndexRef = useRef(currentIndex);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);

  // ── Canvas rendering ──────────────────────────────────────────

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = imageAreaRef.current;
    const img = sourceImg.current;
    if (!canvas || !container || !img) return;

    const rect = container.getBoundingClientRect();
    const cw = rect.width;
    const ch = rect.height;
    if (cw <= 0 || ch <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    const bw = Math.round(cw * dpr);
    const bh = Math.round(ch * dpr);
    if (fullscreenTransitioningRef.current) {
      // During fullscreen animation, only CSS-scale — avoid buffer reallocation jank
      canvas.style.width = cw + "px";
      canvas.style.height = ch + "px";
      return;
    }
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
      canvas.style.width = cw + "px";
      canvas.style.height = ch + "px";
    }

    const ctx = canvas.getContext("2d")!;

    const iw = imgW.current;
    const ih = imgH.current;
    if (iw <= 0 || ih <= 0) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    const z = zoomRef.current;
    const px = panXRef.current;
    const py = panYRef.current;

    const { fw, fh } = getFittedSize(iw, ih, cw, ch);
    const sw = fw * z;
    const sh = fh * z;

    // Top-left of the scaled image in viewport coordinates
    const imgLeft = cw / 2 - sw / 2 + px;
    const imgTop = ch / 2 - sh / 2 + py;

    // Clipped visible rectangle in viewport
    const vL = Math.max(0, imgLeft);
    const vT = Math.max(0, imgTop);
    const vR = Math.min(cw, imgLeft + sw);
    const vB = Math.min(ch, imgTop + sh);
    const vW = vR - vL;
    const vH = vB - vT;
    if (vW <= 0 || vH <= 0) return;

    // Map visible rectangle back to source-image coordinates
    const sL = (vL - imgLeft) / sw * iw;
    const sT = (vT - imgTop) / sh * ih;
    const sW = vW / sw * iw;
    const sH = vH / sh * ih;

    ctx.drawImage(img, sL, sT, sW, sH, vL, vT, vW, vH);
  }, []);

  // Redraw whenever zoom / pan / image / container changes
  useEffect(() => { draw(); }, [zoom, panX, panY, imageUrl, draw]);

  // Redraw on resize (container size changes) — rAF-batched
  useEffect(() => {
    let rafId = 0;
    const onResize = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        draw();
      });
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [draw]);

  // ── Zoom helper ────────────────────────────────────────────────

  const zoomToward = useCallback((cx: number, cy: number, step: number) => {
    const container = imageAreaRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const cw = rect.width;
    const ch = rect.height;
    if (cw <= 0 || ch <= 0) return;

    const oldZ = zoomRef.current;
    const newZ = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldZ + step * oldZ));
    if (newZ === oldZ) return;

    const ratio = newZ / oldZ;
    const px = panXRef.current;
    const py = panYRef.current;
    const newPx = (cx - cw / 2) * (1 - ratio) + px * ratio;
    const newPy = (cy - ch / 2) * (1 - ratio) + py * ratio;

    const c = clampPan(newPx, newPy, newZ, imgW.current, imgH.current, cw, ch);
    setZoom(newZ);
    setPanX(c.x);
    setPanY(c.y);
  }, []);

  function getParentDir(filePath: string): string {
    const normalized = filePath.replace(/\\/g, "/");
    const lastSlash = normalized.lastIndexOf("/");
    return lastSlash >= 0 ? normalized.substring(0, lastSlash) : normalized;
  }

  // ── Image loading ─────────────────────────────────────────────

  const resetView = useCallback(() => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
  }, []);

  // Preload adjacent images into cache for instant navigation
  const preloadAdjacent = useCallback(
    (index: number) => {
      const preloadOne = (i: number) => {
        if (i >= 0 && i < images.length) {
          const path = images[i];
          if (!imageCache.current.has(path)) {
            const img = new Image();
            img.decoding = "async";
            img.src = convertFileSrc(path);
            imageCache.current.set(path, img);
          }
        }
      };

      // High priority: immediate neighbours (±1, ±2)
      preloadOne(index - 1);
      preloadOne(index + 1);
      preloadOne(index - 2);
      preloadOne(index + 2);

      // Lower priority: further neighbours via idle callback
      const scheduleIdle = (i: number) => {
        const doPreload = () => preloadOne(i);
        if (typeof requestIdleCallback !== "undefined") {
          requestIdleCallback(doPreload, { timeout: 2000 });
        } else {
          setTimeout(doPreload, 100);
        }
      };
      scheduleIdle(index - 3);
      scheduleIdle(index + 3);
      scheduleIdle(index - 4);
      scheduleIdle(index + 4);
    },
    [images],
  );

  const loadImage = useCallback(
    async (filePath: string, reset: boolean) => {
      const gen = ++loadGen.current;
      loadStartTimeRef.current = Date.now();
      setLoading(true);
      try {
        const url = convertFileSrc(filePath);
        setImageUrl(url);
        setCurrentFile(filePath);
        setError(null);
        if (reset) {
          resetView();
        }

        // Fetch file metadata in parallel with image loading
        const metadataPromise = invoke<{ size: number; extension: string }>(
          "get_file_info", { filePath },
        ).then((info) => { setFileSize(info.size); setFileFormat(info.extension); })
          .catch(() => { setFileSize(null); setFileFormat(null); });

        // Check cache first for instant display
        const cached = imageCache.current.get(filePath);
        if (cached && cached.complete && cached.naturalWidth > 0) {
          if (loadGen.current !== gen) return;
          sourceImg.current = cached;
          imgW.current = cached.naturalWidth;
          imgH.current = cached.naturalHeight;
          setImageDimensions({ w: cached.naturalWidth, h: cached.naturalHeight });
          draw();
          await metadataPromise;
          return;
        }

        // Load new image with async decoding — keep old sourceImg visible until ready
        const img = new Image();
        img.decoding = "async";
        img.src = url;

        try {
          await img.decode();
        } catch {
          // decode() rejects when the image is broken; onerror path handles it
          if (loadGen.current !== gen) return;
          if (img.naturalWidth === 0) {
            setError("error.loadFailed");
            return;
          }
          // If decode() rejected but image is valid (edge case), fall through
        }

        if (loadGen.current !== gen) return;

        sourceImg.current = img;
        imgW.current = img.naturalWidth;
        imgH.current = img.naturalHeight;
        setImageDimensions({ w: img.naturalWidth, h: img.naturalHeight });
        imageCache.current.set(filePath, img);
        draw();

        await metadataPromise;

        // Preload neighbours after current image loads (only if still current)
        const idx = images.indexOf(filePath);
        if (idx !== -1 && loadGen.current === gen) preloadAdjacent(idx);
      } catch {
        if (loadGen.current !== gen) return;
        setError("error.loadFailed");
      } finally {
        if (loadGen.current === gen) {
          // Ensure loading bar shows for at least 200ms
          const elapsed = Date.now() - loadStartTimeRef.current;
          const minRemaining = Math.max(0, 200 - elapsed);
          if (minRemaining > 0) {
            setTimeout(() => setLoading(false), minRemaining);
          } else {
            setLoading(false);
          }
        }
      }
    },
    [resetView, draw, images, preloadAdjacent]
  );

  const addToRecentFolders = useCallback((folderPath: string) => {
    const name = folderPath.replace(/\\/g, "/").split("/").filter(Boolean).pop() || folderPath;
    setRecentFolders((prev) => {
      const filtered = prev.filter((f) => f.path !== folderPath);
      const updated = [{ name, path: folderPath }, ...filtered].slice(0, 10);
      try { localStorage.setItem("recent-folders", JSON.stringify(updated)); } catch { /* ignore */ }
      return updated;
    });
  }, []);

  const loadFolder = useCallback(
    async (folderPath: string, selectFile?: string) => {
      try {
        const result: {
          parent: string | null;
          subdirs: SubdirInfo[];
          images: string[];
          image_infos: ImageMeta[];
        } = await invoke("list_folder_contents", { folderPath });
        setCurrentFolder(folderPath);
        setSubdirs(result.subdirs);
        imgW.current = 0;
        imgH.current = 0;
        sourceImg.current = null;
        imageCache.current.clear();

        // Populate metadata map
        const metaMap = new Map<string, ImageMetaRecord>();
        for (const info of result.image_infos) {
          metaMap.set(info.path, {
            size: info.size,
            extension: info.extension,
            modified: info.modified,
          });
        }

        // Fetch dimensions upfront if sorting by dimensions or aspect-ratio
        if ((sortBy === "dimensions" || sortBy === "aspect-ratio") && result.images.length > 0) {
          try {
            const dims: { path: string; width: number; height: number }[] =
              await invoke("get_images_dimensions", { filePaths: result.images });
            for (const d of dims) {
              const existing = metaMap.get(d.path);
              if (existing) {
                existing.width = d.width;
                existing.height = d.height;
              }
            }
          } catch { /* ignore — dimensions won't be available */ }
        }

        imageMetaMapRef.current = metaMap;

        // Sort images by current sort criteria
        const sorted = sortImagePaths(result.images, sortBy, sortOrder, metaMap);
        setImages(sorted);

        if (sorted.length > 0) addToRecentFolders(folderPath);

        if (selectFile && sorted.includes(selectFile)) {
          const idx = sorted.indexOf(selectFile);
          setCurrentIndex(idx);
          await loadImage(selectFile, true);
        } else if (sorted.length > 0) {
          setCurrentIndex(0);
          await loadImage(sorted[0], true);
        } else {
          setCurrentIndex(0);
          setCurrentFile(null);
          setImageUrl(null);
        }
      } catch {
        setError("error.listFailed");
      }
    },
    [loadImage, sortBy, sortOrder, addToRecentFolders]
  );

  const openFile = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [{
        name: "Images",
        extensions: [
          "jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif", "tiff", "tif",
        ],
      }],
    });

    if (selected) {
      const folderPath = getParentDir(selected as string);
      await loadFolder(folderPath, selected as string);
    }
  }, [loadFolder]);

  // Smart scheduling: first non-cached press loads immediately (responsive single-step).
  // Rapid repeat (< 400ms burst) → trailing debounce 150ms (skip intermediates).
  // Sustained key-hold (> 400ms burst) → force periodic loads (visual feedback).
  // Cached images always load instantly regardless of burst state.
  const scheduleLoad = useCallback(
    (filePath: string, reset: boolean) => {
      // Cancel any pending debounced load
      if (loadDebounceRef.current) {
        clearTimeout(loadDebounceRef.current);
        loadDebounceRef.current = null;
      }

      // Show loading indicator immediately for all navigations
      setLoading(true);

      // Cached images always load instantly
      const cached = imageCache.current.get(filePath);
      if (cached && cached.complete && cached.naturalWidth > 0) {
        loadDebounceStartRef.current = 0;
        loadImage(filePath, reset);
        return;
      }

      const now = Date.now();
      if (!loadDebounceStartRef.current) {
        // First press in a burst: load immediately for responsive single-step navigation
        loadDebounceStartRef.current = now;
        loadImage(filePath, reset);
        return;
      }

      const burstDuration = now - loadDebounceStartRef.current;
      const THROTTLE_MS = 400;
      const DEBOUNCE_MS = 150;

      let delay: number;
      if (burstDuration > THROTTLE_MS) {
        // Sustained navigation: force an immediate load for visual feedback, then reset burst window
        loadDebounceStartRef.current = now;
        delay = 0;
      } else {
        // Rapid repeat: skip intermediate images, only load when user settles
        delay = DEBOUNCE_MS;
      }

      loadDebounceRef.current = setTimeout(() => {
        loadDebounceRef.current = null;
        loadImage(filePath, reset);
      }, delay);
    },
    [loadImage]
  );

  const navigate = useCallback(
    (delta: number) => {
      if (images.length === 0) return;
      if (momentumRaf.current) { cancelAnimationFrame(momentumRaf.current); momentumRaf.current = 0; }
      const idx = currentIndexRef.current;
      const newIndex = (idx + delta + images.length) % images.length;
      currentIndexRef.current = newIndex;
      setCurrentIndex(newIndex);
      preloadAdjacent(newIndex);
      scheduleLoad(images[newIndex], true);
    },
    [images, scheduleLoad, preloadAdjacent]
  );

  const jumpTo = useCallback(
    (index: number) => {
      if (images.length === 0 || index === currentIndexRef.current) return;
      if (momentumRaf.current) { cancelAnimationFrame(momentumRaf.current); momentumRaf.current = 0; }
      currentIndexRef.current = index;
      setCurrentIndex(index);
      preloadAdjacent(index);
      loadImage(images[index], true);
    },
    [images, loadImage, preloadAdjacent]
  );

  const navigateToFolder = useCallback(
    async (folderPath: string) => {
      await loadFolder(folderPath);
    },
    [loadFolder]
  );

  const navigateUp = useCallback(async () => {
    if (!currentFolder) return;
    const parentPath = getParentDir(currentFolder);
    if (parentPath && parentPath !== currentFolder) {
      await loadFolder(parentPath);
    }
  }, [currentFolder, loadFolder]);

  // Auto-show sidebar when a folder is loaded or recent folders exist
  useEffect(() => {
    if (images.length > 0 || currentFolder || recentFolders.length > 0) {
      setSidebarVisible(true);
    }
  }, [images, currentFolder, recentFolders]);

  // Sync theme attribute and meta tag
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("theme", theme); } catch { /* ignore */ }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", theme === "dark" ? "#080808" : "#faf8f5");
    }
  }, [theme]);

  // Sync language attribute and localStorage
  useEffect(() => {
    document.documentElement.lang = language;
    try { localStorage.setItem("language", language); } catch { /* ignore */ }
  }, [language]);

  // Re-sort images when sort criteria or metadata changes
  useEffect(() => {
    if (images.length === 0) return;
    const currentPath = currentFile || images[currentIndex] || undefined;
    const sorted = sortImagePaths(images, sortBy, sortOrder, imageMetaMapRef.current);
    // Only update if order actually changed
    const orderChanged = sorted.some((p, i) => p !== images[i]);
    if (!orderChanged) return;
    setImages(sorted);
    if (currentPath) {
      const newIdx = sorted.indexOf(currentPath);
      if (newIdx >= 0) setCurrentIndex(newIdx);
    }
  }, [sortBy, sortOrder, metaVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch dimensions when sorting by dimensions or aspect-ratio
  useEffect(() => {
    if (sortBy !== "dimensions" && sortBy !== "aspect-ratio") return;
    if (images.length === 0) return;

    // Find paths that need dimensions
    const missing = images.filter((p) => {
      const meta = imageMetaMapRef.current.get(p);
      return !meta || meta.width === undefined;
    });

    if (missing.length === 0) return;

    let cancelled = false;
    invoke<{ path: string; width: number; height: number }[]>(
      "get_images_dimensions",
      { filePaths: missing },
    )
      .then((dims) => {
        if (cancelled) return;
        const map = imageMetaMapRef.current;
        for (const d of dims) {
          const existing = map.get(d.path);
          if (existing) {
            existing.width = d.width;
            existing.height = d.height;
          }
        }
        setMetaVersion((v) => v + 1);
      })
      .catch(() => {
        // Silently fail - dimensions won't be available
      });

    return () => { cancelled = true; };
  }, [sortBy, images.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const slideshowAdvance = useCallback(() => {
    const imgs = imagesRef.current;
    if (imgs.length === 0) return;
    const newIndex = (currentIndexRef.current + 1) % imgs.length;
    currentIndexRef.current = newIndex;
    setCurrentIndex(newIndex);
    preloadAdjacent(newIndex);
    loadImage(imgs[newIndex], true);
  }, [loadImage, preloadAdjacent]);

  // Slideshow auto-advance
  useEffect(() => {
    if (!slideshowActive || images.length === 0) return;
    const timer = setInterval(() => {
      slideshowAdvance();
    }, slideshowInterval * 1000);
    return () => clearInterval(timer);
  }, [slideshowActive, slideshowInterval, images.length, slideshowAdvance]);

  // Sync fullscreen state with Tauri native window
  useEffect(() => {
    const win = getCurrentWebviewWindow();
    const setup = async () => {
      try {
        // Check initial fullscreen state on load
        const initial = await win.isFullscreen();
        setIsNativeFullscreen(initial);
        let lastFullscreen = initial;

        // Listen for state changes (e.g., via native green button)
        let resizeTimer: ReturnType<typeof setTimeout> | null = null;
        const unlisten = await win.listen("tauri://resize", async () => {
          if (resizeTimer) return;
          resizeTimer = setTimeout(async () => {
            resizeTimer = null;
            const fs = await win.isFullscreen();
            if (fs !== lastFullscreen) {
              lastFullscreen = fs;
              fullscreenTransitioningRef.current = true;
              setIsNativeFullscreen(fs);
              setTimeout(() => {
                fullscreenTransitioningRef.current = false;
                draw();
              }, 600);
            }
          }, 200);
        });
        return unlisten;
      } catch (e) {
        console.error("Fullscreen setup error:", e);
      }
    };
    const promise = setup();
    return () => {
      promise.then((unlisten) => unlisten?.());
    };
  }, []);

  const toggleNativeFullscreen = useCallback(async () => {
    try {
      const win = getCurrentWebviewWindow();
      const current = await win.isFullscreen();
      fullscreenTransitioningRef.current = true;
      await win.setFullscreen(!current);
      setIsNativeFullscreen(!current);
      setTimeout(() => {
        fullscreenTransitioningRef.current = false;
        draw();
      }, 600);
    } catch (e) {
      console.error("Toggle fullscreen error:", e);
    }
  }, []);

  const toggleImmersive = useCallback(() => {
    setIsImmersive((v) => {
      const next = !v;
      if (next) {
        // Entering immersive → also enter native fullscreen if not already
        (async () => {
          try {
            const win = getCurrentWebviewWindow();
            const fs = await win.isFullscreen();
            if (!fs) {
              fullscreenTransitioningRef.current = true;
              await win.setFullscreen(true);
              setIsNativeFullscreen(true);
              setTimeout(() => {
                fullscreenTransitioningRef.current = false;
                draw();
              }, 600);
            }
          } catch { /* ignore */ }
        })();
      }
      return next;
    });
  }, []);

  const cycleSlideshowInterval = useCallback(() => {
    const intervals = [2, 3, 5, 10];
    const idx = intervals.indexOf(slideshowInterval);
    setSlideshowInterval(intervals[(idx + 1) % intervals.length]);
  }, [slideshowInterval]);

  const toggleSlideshow = useCallback(() => {
    setSlideshowActive((a) => !a);
  }, []);

  // ── Context Menu ─────────────────────────────────────────────────

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!currentFile) return;
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY });
    },
    [currentFile],
  );

  const copyImage = useCallback(async () => {
    if (!currentFile) return;
    setContextMenu(null);
    try {
      await invoke("copy_image_to_clipboard", { filePath: currentFile });
    } catch (err) {
      console.error("Failed to copy image:", err);
    }
  }, [currentFile]);

  const setDesktopBackground = useCallback(async () => {
    if (!currentFile) return;
    setContextMenu(null);
    try {
      await invoke("set_desktop_background", { filePath: currentFile });
    } catch (err) {
      console.error("Failed to set desktop background:", err);
    }
  }, [currentFile]);

  const revealInFinder = useCallback(async () => {
    if (!currentFile) return;
    setContextMenu(null);
    try {
      await invoke("reveal_in_finder", { filePath: currentFile });
    } catch (err) {
      console.error("Failed to reveal in Finder:", err);
    }
  }, [currentFile]);

  const handleMoveToTrash = useCallback(async () => {
    if (!currentFile) return;
    const imgs = imagesRef.current;
    if (imgs.length === 0) return;
    setContextMenu(null);
    try {
      await invoke("move_to_trash", { filePath: currentFile });
    } catch (err) {
      console.error("Failed to move to trash:", err);
      return;
    }
    // Remove from metadata map and image cache
    imageMetaMapRef.current.delete(currentFile);
    imageCache.current.delete(currentFile);

    const idx = imgs.indexOf(currentFile);
    const newImages = imgs.filter((_, i) => i !== idx);

    if (newImages.length === 0) {
      setImages([]);
      setCurrentIndex(0);
      setImageUrl(null);
      setCurrentFile(null);
      sourceImg.current = null;
      return;
    }

    const newIdx = idx >= newImages.length
      ? Math.max(0, newImages.length - 1)
      : idx;
    setImages(newImages);
    setCurrentIndex(newIdx);
    imgW.current = 0;
    imgH.current = 0;
    sourceImg.current = null;
    loadImage(newImages[newIdx], true);
  }, [currentFile, loadImage]);

  // Close context menu on outside interaction
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const closeOnScroll = () => setContextMenu(null);
    document.addEventListener("click", close);
    document.addEventListener("contextmenu", close);
    window.addEventListener("scroll", closeOnScroll, { capture: true });
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("contextmenu", close);
      window.removeEventListener("scroll", closeOnScroll, { capture: true });
    };
  }, [contextMenu]);

  // Keyboard
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Space: toggle slideshow (only if an image is loaded)
      if (e.key === " ") {
        if (imageUrl) {
          e.preventDefault();
          setSlideshowActive((a) => !a);
        }
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setSlideshowActive(false);
        navigate(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setSlideshowActive(false);
        navigate(1);
      } else if (e.key === "0") {
        // 0 or Cmd/Ctrl+0: reset zoom
        e.preventDefault();
        resetView();
      } else if ((e.key === "=" || e.key === "+") && (e.metaKey || e.ctrlKey)) {
        // Cmd/Ctrl + =/+ : zoom in
        e.preventDefault();
        const el = imageAreaRef.current;
        if (el) {
          const r = el.getBoundingClientRect();
          zoomToward(r.width / 2, r.height / 2, ZOOM_STEP * 2);
        }
      } else if (e.key === "-" && (e.metaKey || e.ctrlKey)) {
        // Cmd/Ctrl + - : zoom out
        e.preventDefault();
        const el = imageAreaRef.current;
        if (el) {
          const r = el.getBoundingClientRect();
          zoomToward(r.width / 2, r.height / 2, -ZOOM_STEP * 2);
        }
      } else if (e.key === "b" && (e.metaKey || e.ctrlKey)) {
        // Cmd/Ctrl + B : toggle sidebar
        e.preventDefault();
        setSidebarVisible(v => !v);
      } else if (e.key === "Escape") {
        if (settingsOpen) {
          // Handled by SettingsModal's own keydown listener
          return;
        }
        if (isImmersive) {
          e.preventDefault();
          setIsImmersive(false);
        }
      } else if (e.key === "f" || e.key === "F") {
        // F: toggle native window fullscreen
        e.preventDefault();
        toggleNativeFullscreen();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        // Delete/Backspace: move to trash
        e.preventDefault();
        handleMoveToTrash();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate, resetView, zoomToward, toggleNativeFullscreen, isImmersive, settingsOpen, imageUrl, handleMoveToTrash]);

  const loadOpenedFile = useCallback(
    async (filePath: string) => {
      const folderPath = getParentDir(filePath);
      await loadFolder(folderPath, filePath);
    },
    [loadFolder]
  );

  // File opened from outside (e.g., macOS "Open With")
  useEffect(() => {
    // Cold start: check for a file that was opened before the frontend was ready
    invoke<string | null>("get_pending_file").then(async (pendingPath) => {
      if (pendingPath) {
        await loadOpenedFile(pendingPath);
      }
    });

    // Warm start: listen for files opened while the app is already running
    const unlisten = listen<string>("file-opened", async (event) => {
      await loadOpenedFile(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [loadImage, loadOpenedFile]);

  // Close sort dropdown on outside click
  useEffect(() => {
    if (!sortDropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(e.target as Node)) {
        setSortDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [sortDropdownOpen]);

  // ── Wheel: zoom / pan ─────────────────────────────────────────

  useEffect(() => {
    const el = imageAreaRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (isPanning.current) return;
      if (!imageAreaRef.current) return;
      e.preventDefault();

      const isPinch = e.ctrlKey || e.metaKey;

      if (isPinch) {
        const step = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        zoomToward(e.clientX, e.clientY, step);
      } else {
        if (momentumRaf.current) { cancelAnimationFrame(momentumRaf.current); momentumRaf.current = 0; }
        const rect = imageAreaRef.current.getBoundingClientRect();
        const newX = panXRef.current - e.deltaX;
        const newY = panYRef.current - e.deltaY;
        const c = clampPan(newX, newY, zoomRef.current, imgW.current, imgH.current, rect.width, rect.height);
        setPanX(c.x);
        setPanY(c.y);
      }
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [zoomToward]);

  // ── Pointer: drag to pan ──────────────────────────────────────

  const panHandlers = useRef({
    handlePointerDown(e: React.PointerEvent) {
      // Cancel any ongoing momentum animation
      if (momentumRaf.current) {
        cancelAnimationFrame(momentumRaf.current);
        momentumRaf.current = 0;
      }
      velocitySamples.current = [];
      e.preventDefault();
      isPanning.current = true;
      hasPanned.current = false;
      panStart.current = {
        x: e.clientX, y: e.clientY,
        panX: panXRef.current, panY: panYRef.current,
      };
      imageAreaRef.current?.setPointerCapture(e.pointerId);
    },

    handlePointerMove(e: React.PointerEvent) {
      if (!isPanning.current) return;
      velocitySamples.current.push({ x: e.clientX, y: e.clientY, t: performance.now() });
      if (velocitySamples.current.length > 8) velocitySamples.current.shift();
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (!hasPanned.current && dist < PAN_DEAD_ZONE) return;
      if (!hasPanned.current) { hasPanned.current = true; setDragging(true); }

      const el = imageAreaRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const newX = panStart.current.panX + dx;
      const newY = panStart.current.panY + dy;
      const c = clampPan(newX, newY, zoomRef.current, imgW.current, imgH.current, rect.width, rect.height);
      setPanX(c.x);
      setPanY(c.y);
    },

    handlePointerUp() {
      if (!isPanning.current) return;
      isPanning.current = false;
      hasPanned.current = false;
      setDragging(false);

      // Start momentum from velocity samples
      const samples = velocitySamples.current;
      if (samples.length >= 2) {
        const first = samples[0];
        const last = samples[samples.length - 1];
        const dt = last.t - first.t;
        if (dt > 0) {
          const vx = (last.x - first.x) / dt * 16;
          const vy = (last.y - first.y) / dt * 16;
          if (Math.abs(vx) >= 0.5 || Math.abs(vy) >= 0.5) {
            const friction = 0.94;
            const minVel = 0.15;
            let velX = vx;
            let velY = vy;
            const tick = () => {
              const el = imageAreaRef.current;
              if (!el) return;
              const rect = el.getBoundingClientRect();
              const z = zoomRef.current;
              const nx = panXRef.current + velX;
              const ny = panYRef.current + velY;
              const c = clampPan(nx, ny, z, imgW.current, imgH.current, rect.width, rect.height);
              if (c.x !== nx) velX = 0;
              if (c.y !== ny) velY = 0;
              setPanX(c.x);
              setPanY(c.y);
              velX *= friction;
              velY *= friction;
              if (Math.abs(velX) > minVel || Math.abs(velY) > minVel) {
                momentumRaf.current = requestAnimationFrame(tick);
              } else {
                momentumRaf.current = 0;
              }
            };
            momentumRaf.current = requestAnimationFrame(tick);
          }
        }
      }
      velocitySamples.current = [];
    },
  }).current;

  const handleDoubleClick = () => toggleImmersive();

  const fileName = currentFile
    ? currentFile.split(/[/\\]/).pop() || currentFile
    : "";

  // ── Breadcrumb segments ──────────────────────────────────────────

  const breadcrumbs = (() => {
    if (!currentFolder) return [];
    const normalized = currentFolder.replace(/\\/g, "/");
    if (normalized === "/") return [{ name: "/", path: "/" }];
    const parts = normalized.split("/").filter(Boolean);
    const segments: { name: string; path: string }[] = [{ name: "/", path: "/" }];
    let cumulative = "";
    for (const part of parts) {
      cumulative += "/" + part;
      segments.push({ name: part, path: cumulative });
    }
    return segments;
  })();

  // Auto-scroll breadcrumb to end when folder changes
  useEffect(() => {
    const el = breadcrumbRef.current;
    if (el) {
      el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
    }
  }, [currentFolder]);

  const zoomPercent = Math.round(zoom * 100);

  const handleOverflowChange = useCallback((overflowIds: Set<string>) => {
    if (overflowIds.has("sort-controls")) setSortDropdownOpen(false);
  }, []);

  const toolbarItems = useMemo((): ToolbarItemDef[] => {
    const items: ToolbarItemDef[] = [];
    const showExtras = images.length > 0 || !!currentFolder;
    const showCenter = images.length > 1;

    /* ── Left section ─────────────────────────────────────── */

    items.push({
      id: "open", section: "left", priority: 0, condition: true,
      renderToolbar: () => (
        <button className="toolbar-btn" onClick={openFile} title={t("toolbar.openImage", language)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            <rect x="8" y="11" width="8" height="6" rx="1" />
            <circle cx="10" cy="13.5" r="1" />
            <polyline points="21 15 16 10 13 13" />
          </svg>
        </button>
      ),
      renderMenu: () => (
        <button className="toolbar-more-item" onClick={openFile}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          {t("toolbar.openImage", language)}
        </button>
      ),
    });

    items.push({
      id: "sidebar-toggle", section: "left", priority: 5, condition: showExtras,
      renderToolbar: () => (
        <button className={`toolbar-btn${sidebarVisible ? " active" : ""}`} onClick={() => setSidebarVisible((v) => !v)} title={t("toolbar.toggleSidebar", language)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M10 3v18" />
            <rect x="5" y="7" width="3" height="3" fill="currentColor" />
            <rect x="5" y="12" width="3" height="3" fill="currentColor" />
            <rect x="5" y="17" width="3" height="1" fill="currentColor" />
          </svg>
        </button>
      ),
      renderMenu: () => (
        <button className="toolbar-more-item" onClick={() => setSidebarVisible((v) => !v)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M10 3v18" />
          </svg>
          {t("toolbar.toggleSidebar", language)}
        </button>
      ),
    });

    items.push({
      id: "sort-controls", section: "left", priority: 10, condition: showExtras,
      renderToolbar: () => (
        <div className="sort-controls" ref={sortDropdownRef}>
          <button className="sort-btn" onClick={() => setSortDropdownOpen((o) => !o)} title={translate(`sort.${sortBy}`, language)}>
            <span className="sort-label">{translate(`sort.${sortBy}`, language)}</span>
            <svg className="sort-chevron" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {sortDropdownOpen && (
            <div className="sort-dropdown">
              {(["name", "dimensions", "aspect-ratio", "modified"] as SortMode[]).map((mode) => (
                <button key={mode} className={`sort-dropdown-item${mode === sortBy ? " active" : ""}`} onClick={() => { setSortBy(mode); setSortDropdownOpen(false); }}>
                  {translate(`sort.${mode}`, language)}
                </button>
              ))}
            </div>
          )}
          <button className="sort-dir-btn" onClick={() => setSortOrder((o) => (o === "asc" ? "desc" : "asc"))} title={sortOrder === "asc" ? t("sort.ascending", language) : t("sort.descending", language)}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" stroke="none">
              {sortOrder === "asc" ? (
                <>
                  <rect x="0" y="9" width="3" height="3" rx="0.5" opacity="0.35" />
                  <rect x="4.5" y="5" width="3" height="7" rx="0.5" opacity="0.65" />
                  <rect x="9" y="0" width="3" height="12" rx="0.5" />
                </>
              ) : (
                <>
                  <rect x="0" y="0" width="3" height="12" rx="0.5" />
                  <rect x="4.5" y="2" width="3" height="10" rx="0.5" opacity="0.65" />
                  <rect x="9" y="7" width="3" height="5" rx="0.5" opacity="0.35" />
                </>
              )}
            </svg>
          </button>
        </div>
      ),
      renderMenu: () => (
        <>
          <span className="toolbar-more-label">{language === "zh" ? "排序方式" : "Sort by"}</span>
          {(["name", "dimensions", "aspect-ratio", "modified"] as SortMode[]).map((mode) => (
            <button key={mode} className={`toolbar-more-item${mode === sortBy ? " active" : ""}`} onClick={() => setSortBy(mode)}>
              {translate(`sort.${mode}`, language)}
            </button>
          ))}
          <div className="toolbar-more-separator" />
          <button className="toolbar-more-item" onClick={() => setSortOrder((o) => (o === "asc" ? "desc" : "asc"))}>
            {sortOrder === "asc" ? t("sort.ascending", language) : t("sort.descending", language)}
          </button>
        </>
      ),
    });

    items.push({
      id: "filename", section: "left", priority: 35, condition: !!fileName,
      renderToolbar: () => <span className="toolbar-filename">{fileName}</span>,
      renderMenu: () => <span className="toolbar-more-label">{fileName}</span>,
    });

    /* ── Center section ────────────────────────────────────── */

    items.push({
      id: "prev", section: "center", priority: 0, condition: showCenter,
      renderToolbar: () => (
        <button className="toolbar-btn" onClick={() => navigate(-1)} title={t("toolbar.previous", language)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      ),
      renderMenu: () => (
        <button className="toolbar-more-item" onClick={() => navigate(-1)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          {t("toolbar.previous", language)}
        </button>
      ),
    });

    items.push({
      id: "counter", section: "center", priority: 20, condition: showCenter,
      renderToolbar: () => <span className="toolbar-counter">{currentIndex + 1} / {images.length}</span>,
      renderMenu: () => <span className="toolbar-more-label">{currentIndex + 1} / {images.length}</span>,
    });

    items.push({
      id: "next", section: "center", priority: 0, condition: showCenter,
      renderToolbar: () => (
        <button className="toolbar-btn" onClick={() => navigate(1)} title={t("toolbar.next", language)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      ),
      renderMenu: () => (
        <button className="toolbar-more-item" onClick={() => navigate(1)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
          {t("toolbar.next", language)}
        </button>
      ),
    });

    items.push({
      id: "slideshow", section: "center", priority: 15, condition: showCenter,
      renderToolbar: () => (
        <button className="toolbar-btn" onClick={toggleSlideshow} title={slideshowActive ? t("slideshow.pause", language) : t("slideshow.play", language)}>
          {slideshowActive ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <polygon points="6,3 20,12 6,21" />
            </svg>
          )}
        </button>
      ),
      renderMenu: () => (
        <button className="toolbar-more-item" onClick={toggleSlideshow}>
          {slideshowActive ? t("slideshow.pause", language) : t("slideshow.play", language)}
        </button>
      ),
    });

    /* ── Right section ────────────────────────────────────── */

    items.push({
      id: "settings", section: "right", priority: 8, condition: true,
      renderToolbar: () => (
        <button
          className={`toolbar-btn${settingsOpen ? " active" : ""}`}
          onClick={() => setSettingsOpen((v) => !v)}
          title={t("settings.title", language)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      ),
      renderMenu: () => (
        <button className="toolbar-more-item" onClick={() => setSettingsOpen(true)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          {t("settings.title", language)}
        </button>
      ),
    });

    items.push({
      id: "fullscreen", section: "right", priority: 5, condition: true,
      renderToolbar: () => (
        <button className="toolbar-btn" onClick={toggleImmersive} title={isImmersive ? t("toolbar.exitFullscreen", language) : t("toolbar.fullscreen", language)}>
          {isImmersive ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
              <line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          )}
        </button>
      ),
      renderMenu: () => (
        <button className="toolbar-more-item" onClick={toggleImmersive}>
          {isImmersive ? t("toolbar.exitFullscreen", language) : t("toolbar.fullscreen", language)}
        </button>
      ),
    });

    return items;
  }, [
    language,
    images.length, currentFolder,
    sidebarVisible,
    fileName,
    sortBy, sortOrder, sortDropdownOpen,
    isImmersive, isNativeFullscreen,
    imageUrl,
    slideshowActive,
    currentIndex,
    settingsOpen,
    openFile, navigate, toggleSlideshow,
    toggleImmersive, toggleNativeFullscreen,
  ]);

  // Cancel animations and timers on unmount
  useEffect(() => {
    return () => {
      if (momentumRaf.current) {
        cancelAnimationFrame(momentumRaf.current);
        momentumRaf.current = 0;
      }
      if (loadDebounceRef.current) {
        clearTimeout(loadDebounceRef.current);
        loadDebounceRef.current = null;
      }
    };
  }, []);

  const areaClass = "image-area" + (dragging ? " dragging" : imageUrl ? " grab" : "");

  return (
    <div className={`viewer${isNativeFullscreen ? " fullscreen" : ""}${isImmersive ? " immersive" : ""}`}>
      <Sidebar
        images={images}
        currentIndex={currentIndex}
        onSelect={(index) => { setSlideshowActive(false); jumpTo(index); }}
        visible={sidebarVisible}
        currentFolder={currentFolder}
        subdirs={subdirs}
        parentPath={currentFolder ? getParentDir(currentFolder) : null}
        onNavigateFolder={navigateToFolder}
        onNavigateUp={navigateUp}
        language={language}
        recentFolders={recentFolders}
        width={sidebarWidth}
        onWidthChange={(w) => {
          setSidebarWidth(w);
          try { localStorage.setItem("sidebar-width", String(w)); } catch { /* ignore */ }
        }}
      />
      <div className="viewer-right">
        <Toolbar items={toolbarItems} onOverflowChange={handleOverflowChange} />

      {breadcrumbs.length > 0 && (
        <div className="breadcrumb-bar">
          <div className="breadcrumb-list" ref={breadcrumbRef}>
            {breadcrumbs.map((seg, i) => (
              <span key={seg.path} className="breadcrumb-segment">
                {i > 0 && (
                  <svg className="breadcrumb-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 6 15 12 9 18" />
                  </svg>
                )}
                {i < breadcrumbs.length - 1 ? (
                  <button
                    className="breadcrumb-item"
                    onClick={() => navigateToFolder(seg.path)}
                    title={seg.path}
                  >
                    {seg.name}
                  </button>
                ) : (
                  <span className="breadcrumb-item breadcrumb-item--current" title={seg.path}>
                    {seg.name}
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      <div
        ref={imageAreaRef}
        className={areaClass}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        onPointerDown={panHandlers.handlePointerDown}
        onPointerMove={panHandlers.handlePointerMove}
        onPointerUp={panHandlers.handlePointerUp}
        onPointerLeave={panHandlers.handlePointerUp}
        onPointerCancel={panHandlers.handlePointerUp}
      >
        {error ? (
          <div className="state-message">
            <p className="state-error">{translate(error, language)}</p>
            <p className="state-hint">{t("error.openAnother", language)}</p>
          </div>
        ) : imageUrl ? (
          <div className="canvas-stack">
            <canvas ref={canvasRef} className="preview-canvas" />
            <div className={`canvas-loading-bar${loading ? " active" : ""}`} />
          </div>
        ) : currentFolder ? (
          <div className="state-message">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="state-icon">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <p className="state-text">{t("empty.noImages", language)}</p>
            {subdirs.length > 0 && (
              <p className="state-hint">{t("empty.selectSubfolder", language)}</p>
            )}
          </div>
        ) : (
          <div className="state-message">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="state-icon">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <p className="state-text">{t("empty.openPrompt", language)}</p>
            <p className="state-hint">{t("empty.hint", language)}</p>
          </div>
        )}
      </div>

      {imageUrl && !error && (
        <div className="status-bar">
          <div className="status-bar-left">
            {imageDimensions && (
              <span className="status-item">
                {imageDimensions.w} × {imageDimensions.h}
              </span>
            )}
            {fileSize !== null && (
              <span className="status-item">{formatFileSize(fileSize)}</span>
            )}
            {fileFormat && (
              <span className="status-item status-format">{fileFormat}</span>
            )}
          </div>
          <div className="status-bar-right">
            <button className="status-zoom-btn" onClick={() => {
              const el = imageAreaRef.current;
              if (el) { const r = el.getBoundingClientRect(); zoomToward(r.width / 2, r.height / 2, -ZOOM_STEP * 2); }
            }} title={t("toolbar.zoomOut", language)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="12" x2="16" y2="12" />
              </svg>
            </button>
            <span className="status-item status-zoom" onClick={resetView} title={t("toolbar.resetZoom", language)}>
              {zoomPercent}%
            </span>
            <button className="status-zoom-btn" onClick={() => {
              const el = imageAreaRef.current;
              if (el) { const r = el.getBoundingClientRect(); zoomToward(r.width / 2, r.height / 2, ZOOM_STEP * 2); }
            }} title={t("toolbar.zoomIn", language)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {isImmersive && images.length > 0 && (
        <FullscreenStrip
          images={images}
          currentIndex={currentIndex}
          onSelect={(index) => { setSlideshowActive(false); jumpTo(index); }}
          slideshowActive={slideshowActive}
          slideshowInterval={slideshowInterval}
          onToggleSlideshow={toggleSlideshow}
          onCycleInterval={cycleSlideshowInterval}
        />
      )}

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        onThemeChange={setTheme}
        language={language}
        onLanguageChange={setLanguage}
        slideshowInterval={slideshowInterval}
        onSlideshowIntervalChange={setSlideshowInterval}
      />

      {contextMenu && currentFile && (
        <div
          className="context-menu"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 220),
            top: Math.min(contextMenu.y, window.innerHeight - 180),
          }}
        >
          <button className="context-menu-item" onClick={copyImage}>
            {t("context.copyImage", language)}
          </button>
          <button className="context-menu-item" onClick={setDesktopBackground}>
            {t("context.setDesktopBackground", language)}
          </button>
          <div className="context-menu-divider" />
          <button className="context-menu-item" onClick={revealInFinder}>
            {t("context.revealInFinder", language)}
          </button>
          <div className="context-menu-divider" />
          <button className="context-menu-item context-menu-item--danger" onClick={handleMoveToTrash}>
            {t("context.moveToTrash", language)}
          </button>
        </div>
      )}
      </div>
    </div>
  );
}

export default App;
