import { useState, useEffect, useMemo, useCallback, useRef } from "react"; // eslint-disable-line
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import Sidebar, { MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, DEFAULT_SIDEBAR_WIDTH } from "./Sidebar";
import FullscreenStrip from "./FullscreenStrip";
import { loadLanguage, t, translate, type Language } from "./i18n";
import { Toolbar } from "./Toolbar";
import { useToolbarItems } from "./ToolbarItems";
import { LRUImageCache } from "./lruImageCache";
import SettingsModal from "./SettingsModal";
import ShortcutsHelp from "./ShortcutsHelp";
import ConfirmDialog from "./ConfirmDialog";
import { useSlideshow } from "./hooks/useSlideshow";
import { useFullscreen } from "./hooks/useFullscreen";
import { useWindowState } from "./hooks/useWindowState";
import { usePanZoom } from "./hooks/usePanZoom";
import { usePanGesture } from "./hooks/usePanGesture";
import { useFileOperations } from "./hooks/useFileOperations";
import { useImageMetadata } from "./hooks/useImageMetadata";
import { sortImagePaths, filterImagePaths, groupByFolder, type ImageMetaRecord, type FilterMode } from "./utils/sorting";
import { getFittedSize } from "./utils/geometry";
import { formatFileSize, getParentDir } from "./utils/format";
import "./App.css";
import "./Toolbar.css";

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ mode: "single" | "batch" } | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const [loading, setLoading] = useState(false);

  // Recursive slideshow: when set, all images from this folder + subdirs are loaded
  const [recursiveRoot, setRecursiveRoot] = useState<string | null>(null);

  // Image filter
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
  const [filterLoading, setFilterLoading] = useState(false);
  const filterDropdownRef = useRef<HTMLDivElement>(null);
  const unfilteredImagesRef = useRef<string[]>([]);

  // Refs shared across subsystems
  const imageCache = useRef<LRUImageCache>(new LRUImageCache());
  const imgW = useRef(0);
  const imgH = useRef(0);
  const sourceImg = useRef<HTMLImageElement | null>(null);
  const imageAreaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fullscreenTransitioningRef = useRef(false);
  const breadcrumbRef = useRef<HTMLDivElement>(null);

  // Image loading refs
  const loadGen = useRef(0);
  const pendingImgRef = useRef<HTMLImageElement | null>(null);
  const loadDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadDebounceStartRef = useRef(0);
  const loadStartTimeRef = useRef(0);

  // File info for status bar
  const [imageDimensions, setImageDimensions] = useState<{ w: number; h: number } | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [fileFormat, setFileFormat] = useState<string | null>(null);

  const [drawVersion, setDrawVersion] = useState(0);

  // Multi-select for batch operations
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());

  // ── Composed hooks ─────────────────────────────────────────────

  const pz = usePanZoom({ imageAreaRef, imgW, imgH });

  const meta = useImageMetadata({ images, currentFile, setImages, setCurrentIndex, unfilteredImagesRef, filterMode });

  const gestures = usePanGesture({
    imageAreaRef,
    zoomRef: pz.zoomRef, panXRef: pz.panXRef, panYRef: pz.panYRef,
    rotationRef: pz.rotationRef,
    imgW, imgH,
    setPanX: pz.setPanX, setPanY: pz.setPanY,
    zoomToward: pz.zoomToward,
  });

  // Refs for slideshow auto-advance (avoid stale closures in setInterval)
  const imagesRef = useRef(images);
  useEffect(() => { imagesRef.current = images; }, [images]);
  const currentIndexRef = useRef(currentIndex);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);

  // O(1) lookup maps for hot paths (indexOf / includes on large lists)
  const imageIndexMapRef = useRef<Map<string, number>>(new Map());
  const imageSetRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const map = new Map<string, number>();
    const set = new Set<string>();
    for (let i = 0; i < images.length; i++) {
      map.set(images[i], i);
      set.add(images[i]);
    }
    imageIndexMapRef.current = map;
    imageSetRef.current = set;
  }, [images]);

  // Re-filter when filter mode changes. Also fetch dimensions for
  // unfiltered images when a shape filter is active, so filtering
  // takes effect even under the default "name" sort.
  useEffect(() => {
    if (unfilteredImagesRef.current.length === 0) return;
    const currentPath = currentFile;
    const filtered = filterImagePaths(unfilteredImagesRef.current, filterMode, meta.imageMetaMapRef.current);
    if (filtered.length === 0) return;
    setImages(filtered);
    if (currentPath) {
      const newIdx = filtered.indexOf(currentPath);
      if (newIdx >= 0) {
        setCurrentIndex(newIdx);
      } else {
        setCurrentIndex(0);
        loadImage(filtered[0], true);
      }
    }

    if (filterMode !== "all") {
      const missing = unfilteredImagesRef.current.filter((p) => {
        const m = meta.imageMetaMapRef.current.get(p);
        return !m || m.width === undefined;
      });
      if (missing.length > 0) {
        setFilterLoading(true);
        // Fetch dimensions in chunks so the UI updates progressively
        const CHUNK = 100;
        (async () => {
          let hasNew = false;
          try {
            for (let i = 0; i < missing.length; i += CHUNK) {
              const batch = missing.slice(i, i + CHUNK);
              const dims = await invoke<{ path: string; width: number; height: number }[]>(
                "get_images_dimensions", { filePaths: batch },
              );
              const map = meta.imageMetaMapRef.current;
              for (const d of dims) {
                const existing = map.get(d.path);
                if (existing && existing.width === undefined) {
                  existing.width = d.width;
                  existing.height = d.height;
                  hasNew = true;
                }
              }
              if (hasNew) {
                meta.setMetaVersion((v) => v + 1);
                // Apply filter immediately with newly loaded dimensions
                const reFiltered = filterImagePaths(
                  unfilteredImagesRef.current, filterMode, meta.imageMetaMapRef.current,
                );
                setImages(reFiltered);
                if (currentFile && !reFiltered.includes(currentFile) && reFiltered.length > 0) {
                  loadImage(reFiltered[0], true);
                }
                hasNew = false;
              }
            }
          } catch { /* ignore */ }
          setFilterLoading(false);
        })();
      }
    }
  }, [filterMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // When images change (filter/sort), if the current file is no longer
  // in the list, switch to the first image.
  useEffect(() => {
    if (images.length === 0 || !currentFile) return;
    if (currentFile && !imageSetRef.current.has(currentFile)) {
      loadImage(images[0], true);
    }
  }, [images, currentFile]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Canvas rendering ──────────────────────────────────────────

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = imageAreaRef.current;
    const img = sourceImg.current;
    if (!canvas || !container || !img) return;

    // During fullscreen transition, skip all canvas work — avoid
    // forced layouts and style mutations while the window animates.
    if (fullscreenTransitioningRef.current) return;

    const rect = container.getBoundingClientRect();
    const cw = rect.width;
    const ch = rect.height;
    if (cw <= 0 || ch <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    const bw = Math.round(cw * dpr);
    const bh = Math.round(ch * dpr);
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

    const z = pz.zoomRef.current;
    const px = pz.panXRef.current;
    const py = pz.panYRef.current;
    const rot = pz.rotation;

    // When rotated 90/270, the canvas rotation transforms the coordinate
    // system, so the container appears swapped. Compute fitted size using
    // the original image dimensions matched against the swapped container.
    const isSwapped = rot === 90 || rot === 270;
    const fitW = isSwapped ? ch : cw;
    const fitH = isSwapped ? cw : ch;
    const { fw, fh } = getFittedSize(iw, ih, fitW, fitH);
    const sw = fw * z;
    const sh = fh * z;

    // Apply rotation around container center
    if (rot !== 0) {
      ctx.save();
      ctx.translate(cw / 2, ch / 2);
      ctx.rotate((rot * Math.PI) / 180);
      ctx.translate(-cw / 2, -ch / 2);
    }

    // Top-left of the scaled image in viewport coordinates
    const imgLeft = cw / 2 - sw / 2 + px;
    const imgTop = ch / 2 - sh / 2 + py;

    if (rot === 0 || rot === 180) {
      // Clipped visible rectangle in viewport
      const vL = Math.max(0, imgLeft);
      const vT = Math.max(0, imgTop);
      const vR = Math.min(cw, imgLeft + sw);
      const vB = Math.min(ch, imgTop + sh);
      const vW = vR - vL;
      const vH = vB - vT;
      if (vW > 0 && vH > 0) {
        const sL = (vL - imgLeft) / sw * iw;
        const sT = (vT - imgTop) / sh * ih;
        const sW = vW / sw * iw;
        const sH = vH / sh * ih;
        ctx.drawImage(img, sL, sT, sW, sH, vL, vT, vW, vH);
      }
    } else {
      // For 90/270, draw the full image (no sub-rect clipping —
      // the coordinate system is already rotated by the canvas transform)
      ctx.drawImage(img, imgLeft, imgTop, sw, sh);
    }

    if (rot !== 0) {
      ctx.restore();
    }
  }, [pz.rotation]);

  // ── Fullscreen ─────────────────────────────────────────────────
  const {
    isNativeFullscreen,
    isImmersive, setIsImmersive,
    toggleNativeFullscreen, toggleImmersive,
  } = useFullscreen({ draw, fullscreenTransitioningRef });

  // Persist window position/size
  useWindowState();

  // Redraw on zoom/pan change or explicit draw trigger (image switch).
  // drawVersion ensures a draw even when zoom/pan stay at default values.
  useEffect(() => { draw(); }, [pz.zoom, pz.panX, pz.panY, drawVersion, draw]);

  // Redraw on resize (container size changes) — rAF-batched.
  // Skip during fullscreen transition: the tauri://resize handler
  // (or the double-rAF fallback) takes care of the final draw.
  useEffect(() => {
    let rafId = 0;
    const onResize = () => {
      if (rafId || fullscreenTransitioningRef.current) return;
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

  // ── Image loading ─────────────────────────────────────────────

  // Preload adjacent images into cache for instant navigation
  const preloadAdjacent = useCallback(
    (index: number) => {
      const preloadOne = (i: number) => {
        if (i >= 0 && i < images.length) {
          const path = images[i];
          if (imageCache.current.markLoading(path)) {
            const img = new Image();
            img.decoding = "async";
            img.onload = () => {
              img.onload = null; img.onerror = null;
              imageCache.current.set(path, img);
            };
            img.onerror = () => {
              img.onload = null; img.onerror = null;
              imageCache.current.unmarkLoading(path);
            };
            img.src = convertFileSrc(path);
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
      // Abort any in-flight image download from previous navigation
      if (pendingImgRef.current) {
        pendingImgRef.current.src = "";
        pendingImgRef.current = null;
      }
      const gen = ++loadGen.current;
      loadStartTimeRef.current = Date.now();
      setLoading(true);
      try {
        const url = convertFileSrc(filePath);
        setImageUrl(url);
        setCurrentFile(filePath);
        setError(null);
        // Delay pz.resetView until new image is decoded — keeping the old
        // image at its current zoom/pan prevents a visual jump.

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
          if (reset) {
            pz.zoomRef.current = 1; pz.panXRef.current = 0; pz.panYRef.current = 0;
            pz.setZoom(1); pz.setPanX(0); pz.setPanY(0);
          }
          // Force draw even when zoom/pan are already at default values
          setDrawVersion(v => v + 1);
          await metadataPromise;
          return;
        }

        // Load new image with async decoding — keep old sourceImg visible until ready
        const img = new Image();
        pendingImgRef.current = img;
        img.decoding = "async";
        img.src = url;

        try {
          await img.decode();
        } catch {
          // decode() rejects when the image is broken; onerror path handles it
          if (loadGen.current !== gen) return;
          pendingImgRef.current = null;
          if (img.naturalWidth === 0) {
            setError("error.loadFailed");
            return;
          }
          // If decode() rejected but image is valid (edge case), fall through
        }

        if (loadGen.current !== gen) return;

        pendingImgRef.current = null;
        sourceImg.current = img;
        imgW.current = img.naturalWidth;
        imgH.current = img.naturalHeight;
        setImageDimensions({ w: img.naturalWidth, h: img.naturalHeight });
        imageCache.current.set(filePath, img);
        if (reset) {
          pz.zoomRef.current = 1; pz.panXRef.current = 0; pz.panYRef.current = 0;
          pz.setZoom(1); pz.setPanX(0); pz.setPanY(0);
        }
        // Force draw even when zoom/pan are already at default values
        setDrawVersion(v => v + 1);

        await metadataPromise;

        // Preload neighbours after current image loads (only if still current)
        const idx = imageIndexMapRef.current.get(filePath) ?? -1;
        if (idx !== -1 && loadGen.current === gen) preloadAdjacent(idx);
      } catch {
        if (loadGen.current !== gen) return;
        pendingImgRef.current = null;
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
    [draw, images, preloadAdjacent]
  );

  // ── Slideshow ─────────────────────────────────────────────────
  const {
    slideshowActive, setSlideshowActive,
    slideshowInterval, setSlideshowInterval,
    slideshowMode, cycleSlideshowMode,
    toggleSlideshow, cycleSlideshowInterval, resetSlideshowInterval,
  } = useSlideshow({
    imagesRef,
    currentIndexRef,
    imageCount: images.length,
    setCurrentIndex,
    loadImage,
    preloadAdjacent,
  });

  const fileOps = useFileOperations({
    currentFile,
    selectedIndices,
    setSelectedIndices,
    imagesRef,
    currentIndexRef,
    imageMetaMapRef: meta.imageMetaMapRef,
    imageIndexMapRef,
    imageCache,
    loadImage,
    setImages,
    setCurrentIndex,
    setImageUrl,
    setCurrentFile,
    imgW,
    imgH,
    sourceImg,
  });

  const addToRecentFolders = useCallback((folderPath: string) => {
    const name = folderPath.replace(/\\/g, "/").split("/").filter(Boolean).pop() || folderPath;
    setRecentFolders((prev) => {
      const filtered = prev.filter((f) => f.path !== folderPath);
      const updated = [{ name, path: folderPath }, ...filtered].slice(0, 10);
      try { localStorage.setItem("recent-folders", JSON.stringify(updated)); } catch { /* ignore */ }
      return updated;
    });
  }, []);

  const loadRecursiveFolder = useCallback(
    async (folderPath: string) => {
      setFilterMode("all");
      try {
        const result: {
          parent: string | null;
          subdirs: SubdirInfo[];
          images: string[];
          image_infos: ImageMeta[];
        } = await invoke("list_recursive_images", { folderPath });
        setCurrentFolder(folderPath);
        setSubdirs(result.subdirs);
        imgW.current = 0;
        imgH.current = 0;
        sourceImg.current = null;
        imageCache.current.clear();

        const metaMap = new Map<string, ImageMetaRecord>();
        for (const info of result.image_infos) {
          metaMap.set(info.path, {
            size: info.size,
            extension: info.extension,
            modified: info.modified,
          });
        }
        meta.imageMetaMapRef.current = metaMap;

        const sorted = sortImagePaths(result.images, meta.sortBy, meta.sortOrder, metaMap);
        const grouped = groupByFolder(sorted);
        unfilteredImagesRef.current = grouped;
        const filtered = filterImagePaths(grouped, filterMode, metaMap);
        setImages(filtered);
        setRecursiveRoot(folderPath);

        if (sorted.length > 0) {
          addToRecentFolders(folderPath);
        }

        if ((meta.sortBy === "dimensions" || meta.sortBy === "aspect-ratio") && sorted.length > 0) {
          invoke<{ path: string; width: number; height: number }[]>(
            "get_images_dimensions", { filePaths: sorted },
          ).then((dims) => {
            const map = meta.imageMetaMapRef.current;
            let hasNew = false;
            for (const d of dims) {
              const existing = map.get(d.path);
              if (existing && existing.width === undefined) {
                existing.width = d.width;
                existing.height = d.height;
                hasNew = true;
              }
            }
            if (hasNew) meta.setMetaVersion((v) => v + 1);
          }).catch(() => {});
        }

        if (sorted.length > 0) {
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
    [meta.sortBy, meta.sortOrder, loadImage, addToRecentFolders, setFilterMode]
  );

  const loadFolder = useCallback(
    async (folderPath: string, selectFile?: string) => {
      setFilterMode("all");
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

        meta.imageMetaMapRef.current = metaMap;

        // Sort images by current sort criteria (unknown dimensions = 0, sort to end)
        const sorted = sortImagePaths(result.images, meta.sortBy, meta.sortOrder, metaMap);
        unfilteredImagesRef.current = sorted;
        const filtered = filterImagePaths(sorted, filterMode, metaMap);
        setImages(filtered);

        if (sorted.length > 0) addToRecentFolders(folderPath);

        // For dimension-dependent sorts, load dimensions in background after first image is shown
        if ((meta.sortBy === "dimensions" || meta.sortBy === "aspect-ratio") && sorted.length > 0) {
          const imagesToMeasure = sorted;
          invoke<{ path: string; width: number; height: number }[]>(
            "get_images_dimensions", { filePaths: imagesToMeasure },
          ).then((dims) => {
            const map = meta.imageMetaMapRef.current;
            let hasNew = false;
            for (const d of dims) {
              const existing = map.get(d.path);
              if (existing && existing.width === undefined) {
                existing.width = d.width;
                existing.height = d.height;
                hasNew = true;
              }
            }
            if (hasNew) meta.setMetaVersion((v) => v + 1);
          }).catch(() => {});
        }

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
    [loadImage, meta.sortBy, meta.sortOrder, addToRecentFolders, setFilterMode]
  );

  const openFile = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [{
        name: "Images",
        extensions: [
          "jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif", "tiff", "tif", "heic", "heif",
        ],
      }],
    });

    if (selected) {
      setRecursiveRoot(null);
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

      // Show loading indicator immediately (needed for debounced loads)
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
      if (gestures.momentumRaf.current) { cancelAnimationFrame(gestures.momentumRaf.current); gestures.momentumRaf.current = 0; }
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
      if (gestures.momentumRaf.current) { cancelAnimationFrame(gestures.momentumRaf.current); gestures.momentumRaf.current = 0; }
      currentIndexRef.current = index;
      setCurrentIndex(index);
      preloadAdjacent(index);
      loadImage(images[index], true);
    },
    [images, loadImage, preloadAdjacent]
  );

  const navigateToFolder = useCallback(
    async (folderPath: string) => {
      setRecursiveRoot(null);
      await loadFolder(folderPath);
    },
    [loadFolder]
  );

  const navigateUp = useCallback(async () => {
    if (!currentFolder) return;
    const parentPath = getParentDir(currentFolder);
    if (parentPath && parentPath !== currentFolder) {
      setRecursiveRoot(null);
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
        resetSlideshowInterval();
        navigate(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        resetSlideshowInterval();
        navigate(1);
      } else if (e.key === "?" && !(e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setShortcutsOpen(true);
      } else if (e.key === "0") {
        // 0 or Cmd/Ctrl+0: reset zoom
        e.preventDefault();
        pz.resetView();
      } else if ((e.key === "=" || e.key === "+") && (e.metaKey || e.ctrlKey)) {
        // Cmd/Ctrl + =/+ : zoom in
        e.preventDefault();
        const el = imageAreaRef.current;
        if (el) {
          const r = el.getBoundingClientRect();
          pz.zoomToward(r.width / 2, r.height / 2, pz.ZOOM_STEP * 2);
        }
      } else if (e.key === "-" && (e.metaKey || e.ctrlKey)) {
        // Cmd/Ctrl + - : zoom out
        e.preventDefault();
        const el = imageAreaRef.current;
        if (el) {
          const r = el.getBoundingClientRect();
          pz.zoomToward(r.width / 2, r.height / 2, -pz.ZOOM_STEP * 2);
        }
      } else if (e.key === "b" && (e.metaKey || e.ctrlKey)) {
        // Cmd/Ctrl + B : toggle sidebar
        e.preventDefault();
        setSidebarVisible(v => !v);
      } else if (e.key === "Escape") {
        if (settingsOpen || shortcutsOpen || deleteConfirm) {
          // Handled by respective modal's own keydown listener
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
      } else if ((e.key === "c" || e.key === "C") && (e.metaKey || e.ctrlKey)) {
        // Cmd/Ctrl+C: copy image to clipboard
        e.preventDefault();
        fileOps.copyImage();
      } else if ((e.key === "r" || e.key === "R") && !(e.metaKey || e.ctrlKey || e.shiftKey)) {
        // R: rotate clockwise 90°
        e.preventDefault();
        pz.setRotation((r) => (r + 90) % 360);
        pz.resetView();
      } else if ((e.key === "R") && e.shiftKey) {
        // Shift+R: rotate counterclockwise 90°
        e.preventDefault();
        pz.setRotation((r) => (r + 270) % 360);
        pz.resetView();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        if (selectedIndices.size > 0) {
          setDeleteConfirm({ mode: "batch" });
        } else {
          setDeleteConfirm({ mode: "single" });
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate, pz.resetView, pz.zoomToward, toggleNativeFullscreen, isImmersive, settingsOpen, shortcutsOpen, deleteConfirm, selectedIndices, imageUrl, fileOps.copyImage]);

  const loadOpenedFile = useCallback(
    async (filePath: string) => {
      setRecursiveRoot(null);
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
    if (!meta.sortDropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (meta.sortDropdownRef.current && !meta.sortDropdownRef.current.contains(e.target as Node)) {
        meta.setSortDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [meta.sortDropdownOpen]);

  // Close filter dropdown on outside click
  useEffect(() => {
    if (!filterDropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(e.target as Node)) {
        setFilterDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [filterDropdownOpen]);

  const handleDoubleClick = () => toggleImmersive();

  const fileName = useMemo(() => {
    return currentFile
      ? currentFile.split(/[/\\]/).pop() || currentFile
      : "";
  }, [currentFile]);

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

  const zoomPercent = Math.round(pz.zoom * 100);

  const handleOverflowChange = useCallback((overflowIds: Set<string>) => {
    if (overflowIds.has("sort-controls")) meta.setSortDropdownOpen(false);
  }, []);

  // ── Toolbar items ──────────────────────────────────────────────────
  const showExtras = images.length > 0 || !!currentFolder;
  const showCenter = images.length > 1;

  const toolbarItems = useToolbarItems({
    language,
    showExtras,
    showCenter,
    sidebarVisible,
    fileName,
    sortBy: meta.sortBy,
    sortOrder: meta.sortOrder,
    sortDropdownOpen: meta.sortDropdownOpen,
    currentIndex,
    imageCount: images.length,
    slideshowActive,
    slideshowMode,
    settingsOpen,
    isImmersive,
    recursiveRoot,
    onExitRecursive: () => {
      setRecursiveRoot(null);
      if (currentFolder) loadFolder(currentFolder);
    },
    filterMode,
    setFilterMode,
    filterDropdownOpen,
    setFilterDropdownOpen,
    filterDropdownRef,
    openFile,
    navigate,
    toggleSlideshow,
    cycleSlideshowMode,
    toggleImmersive,
    setSortBy: meta.setSortBy,
    setSortOrder: meta.setSortOrder,
    setSortDropdownOpen: meta.setSortDropdownOpen,
    setSidebarVisible,
    setSettingsOpen,
    setShortcutsOpen,
  });

  // Cancel animations and timers on unmount
  useEffect(() => {
    return () => {
      if (gestures.momentumRaf.current) {
        cancelAnimationFrame(gestures.momentumRaf.current);
        gestures.momentumRaf.current = 0;
      }
      if (loadDebounceRef.current) {
        clearTimeout(loadDebounceRef.current);
        loadDebounceRef.current = null;
      }
      if (pendingImgRef.current) {
        pendingImgRef.current.src = "";
        pendingImgRef.current = null;
      }
    };
  }, []);

  const areaClass = "image-area" + (gestures.dragging ? " dragging" : imageUrl ? " grab" : "");

  return (
    <div className={`viewer${isNativeFullscreen ? " fullscreen" : ""}${isImmersive ? " immersive" : ""}`}>
      <Sidebar
        images={images}
        currentIndex={currentIndex}
        onSelect={(index) => { resetSlideshowInterval(); jumpTo(index); }}
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
        selectedIndices={selectedIndices}
        onSelectedIndicesChange={setSelectedIndices}
        onBatchDelete={fileOps.handleBatchDelete}
        onRequestBatchDelete={() => setDeleteConfirm({ mode: "batch" })}
        recursiveRoot={recursiveRoot}
        onRecursivePlay={(path) => {
          loadRecursiveFolder(path);
        }}
        onCloseFolder={() => {
          setRecursiveRoot(null);
          setImages([]);
          setCurrentIndex(0);
          setImageUrl(null);
          setCurrentFile(null);
          setCurrentFolder(null);
          setSubdirs([]);
          sourceImg.current = null;
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
        onContextMenu={fileOps.handleContextMenu}
        onPointerDown={gestures.panHandlers.handlePointerDown}
        onPointerMove={gestures.panHandlers.handlePointerMove}
        onPointerUp={gestures.panHandlers.handlePointerUp}
        onPointerLeave={gestures.panHandlers.handlePointerUp}
        onPointerCancel={gestures.panHandlers.handlePointerUp}
      >
        {error ? (
          <div className="state-message">
            <p className="state-error">{translate(error, language)}</p>
            <p className="state-hint">{t("error.openAnother", language)}</p>
          </div>
        ) : imageUrl ? (
          <div className="canvas-stack">
            <canvas ref={canvasRef} className="preview-canvas" />
            <div className={`canvas-loading-bar${loading || filterLoading ? " active" : ""}`} />
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
                {pz.rotation % 180 === 0
                  ? `${imageDimensions.w} × ${imageDimensions.h}`
                  : `${imageDimensions.h} × ${imageDimensions.w}`}
              </span>
            )}
            {fileSize !== null && (
              <span className="status-item">{formatFileSize(fileSize)}</span>
            )}
            {pz.rotation !== 0 && (
              <span className="status-item">{pz.rotation}°</span>
            )}
            {fileFormat && (
              <span className="status-item status-format">{fileFormat}</span>
            )}
          </div>
          <div className="status-bar-right">
            <button className="status-zoom-btn" onClick={() => {
              const el = imageAreaRef.current;
              if (el) { const r = el.getBoundingClientRect(); pz.zoomToward(r.width / 2, r.height / 2, -pz.ZOOM_STEP * 2); }
            }} title={t("toolbar.zoomOut", language)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="12" x2="16" y2="12" />
              </svg>
            </button>
            <span className="status-item status-zoom" onClick={pz.resetView} title={t("toolbar.resetZoom", language)}>
              {zoomPercent}%
            </span>
            <button className="status-zoom-btn" onClick={() => {
              const el = imageAreaRef.current;
              if (el) { const r = el.getBoundingClientRect(); pz.zoomToward(r.width / 2, r.height / 2, pz.ZOOM_STEP * 2); }
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
          onSelect={(index) => { resetSlideshowInterval(); jumpTo(index); }}
          slideshowActive={slideshowActive}
          slideshowInterval={slideshowInterval}
          slideshowMode={slideshowMode}
          onToggleSlideshow={toggleSlideshow}
          onCycleInterval={cycleSlideshowInterval}
          onCycleMode={cycleSlideshowMode}
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

      <ShortcutsHelp
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        language={language}
      />

      {deleteConfirm && (
        <ConfirmDialog
          open={true}
          title={t("confirm.delete.title", language)}
          message={
            deleteConfirm.mode === "batch"
              ? t("confirm.delete.batch", language).replace("{count}", String(selectedIndices.size))
              : t("confirm.delete.single", language)
          }
          confirmLabel={t("confirm.delete.confirm", language)}
          cancelLabel={t("confirm.delete.cancel", language)}
          danger
          onConfirm={() => {
            const mode = deleteConfirm.mode;
            setDeleteConfirm(null);
            if (mode === "single") {
              fileOps.handleMoveToTrash();
            } else {
              fileOps.handleBatchDelete();
            }
          }}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}

      {fileOps.contextMenu && currentFile && (
        <div
          className="context-menu"
          style={{
            left: Math.min(fileOps.contextMenu.x, window.innerWidth - 220),
            top: Math.min(fileOps.contextMenu.y, window.innerHeight - 180),
          }}
        >
          <button className="context-menu-item" onClick={fileOps.copyImage}>
            {t("context.copyImage", language)}
          </button>
          <button className="context-menu-item" onClick={() => { pz.setRotation((r) => (r + 90) % 360); pz.resetView(); fileOps.setContextMenu(null); }}>
            {t("context.rotate", language)}
          </button>
          <button className="context-menu-item" onClick={fileOps.setDesktopBackground}>
            {t("context.setDesktopBackground", language)}
          </button>
          <div className="context-menu-divider" />
          <button className="context-menu-item" onClick={fileOps.revealInFinder}>
            {t("context.revealInFinder", language)}
          </button>
          <div className="context-menu-divider" />
          <button className="context-menu-item context-menu-item--danger" onClick={() => { fileOps.setContextMenu(null); setDeleteConfirm({ mode: "single" }); }}>
            {t("context.moveToTrash", language)}
          </button>
        </div>
      )}
      </div>
    </div>
  );
}

export default App;
