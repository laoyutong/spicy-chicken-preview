import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import "./App.css";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 10;
const ZOOM_STEP = 0.1;
const PAN_DEAD_ZONE = 3;

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

function clampPan(
  px: number, py: number, zoomVal: number,
  imgW: number, imgH: number, cw: number, ch: number,
): { x: number; y: number } {
  if (imgW <= 0 || imgH <= 0 || cw <= 0 || ch <= 0) return { x: 0, y: 0 };
  const { fw, fh } = getFittedSize(imgW, imgH, cw, ch);
  const sw = fw * zoomVal;
  const sh = fh * zoomVal;
  const maxX = Math.max(0, (sw - cw) / 2);
  const maxY = Math.max(0, (sh - ch) / 2);
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

  // Zoom & pan
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [dragging, setDragging] = useState(false);

  const zoomRef = useRef(zoom);
  const panXRef = useRef(panX);
  const panYRef = useRef(panY);
  const imgW = useRef(0);
  const imgH = useRef(0);
  const sourceImg = useRef<HTMLImageElement | null>(null);
  const isPanning = useRef(false);
  const hasPanned = useRef(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const imageAreaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panXRef.current = panX; }, [panX]);
  useEffect(() => { panYRef.current = panY; }, [panY]);

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
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
      canvas.style.width = cw + "px";
      canvas.style.height = ch + "px";
    }

    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    const iw = imgW.current;
    const ih = imgH.current;
    if (iw <= 0 || ih <= 0) return;

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

  // Redraw on resize (container size changes)
  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw]);

  // ── Image loading ─────────────────────────────────────────────

  const resetView = useCallback(() => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
  }, []);

  const loadImage = useCallback(
    async (filePath: string, reset: boolean) => {
      try {
        const url = convertFileSrc(filePath);
        setImageUrl(url);
        setCurrentFile(filePath);
        setError(null);
        if (reset) {
          resetView();
        }

        // Preload image into off-screen Image element
        const img = new Image();
        img.onload = () => {
          sourceImg.current = img;
          imgW.current = img.naturalWidth;
          imgH.current = img.naturalHeight;
          draw();
        };
        img.onerror = () => {
          setError("Failed to load image");
          sourceImg.current = null;
        };
        img.src = url;
        sourceImg.current = null;
      } catch {
        setError("Failed to load image");
      }
    },
    [resetView, draw]
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
      try {
        const imageList: string[] = await invoke("list_images_in_folder", {
          filePath: selected,
        });
        const idx = imageList.indexOf(selected as string);
        setImages(imageList);
        setCurrentIndex(idx >= 0 ? idx : 0);
        imgW.current = 0;
        imgH.current = 0;
        sourceImg.current = null;
        await loadImage(selected as string, true);
      } catch {
        setError("Failed to list images in folder");
      }
    }
  }, [loadImage]);

  const navigate = useCallback(
    (delta: number) => {
      if (images.length === 0) return;
      const newIndex = (currentIndex + delta + images.length) % images.length;
      setCurrentIndex(newIndex);
      imgW.current = 0;
      imgH.current = 0;
      sourceImg.current = null;
      loadImage(images[newIndex], true);
    },
    [images, currentIndex, loadImage]
  );

  // Keyboard
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        navigate(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        navigate(1);
      } else if (e.key === "0" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        resetView();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate, resetView]);

  const loadOpenedFile = useCallback(
    async (filePath: string) => {
      try {
        const imageList: string[] = await invoke("list_images_in_folder", {
          filePath,
        });
        const idx = imageList.indexOf(filePath);
        setImages(imageList);
        setCurrentIndex(idx >= 0 ? idx : 0);
        imgW.current = 0;
        imgH.current = 0;
        sourceImg.current = null;
        await loadImage(filePath, true);
      } catch {
        setError("Failed to open image");
      }
    },
    [loadImage]
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

  // ── Wheel: zoom / pan ─────────────────────────────────────────

  useEffect(() => {
    const el = imageAreaRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (isPanning.current) return;
      if (!imageAreaRef.current) return;
      e.preventDefault();

      const isPinch = e.ctrlKey || e.metaKey;

      if (isPinch || zoomRef.current <= 1) {
        const step = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        setZoom((prev) => {
          const next = prev + step;
          if (next <= 1) {
            setPanX(0);
            setPanY(0);
          }
          return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
        });
      } else {
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
  }, []);

  // ── Pointer: drag to pan ──────────────────────────────────────

  const panHandlers = useRef({
    handlePointerDown(e: React.PointerEvent) {
      if (zoomRef.current <= 1) return;
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
    },
  }).current;

  const handleDoubleClick = () => resetView();

  const fileName = currentFile
    ? currentFile.split(/[/\\]/).pop() || currentFile
    : "";

  const zoomPercent = Math.round(zoom * 100);
  const areaClass = "image-area" + (dragging ? " dragging" : zoom > 1 ? " grab" : "");

  return (
    <div className="viewer">
      <div className="toolbar">
        <div className="toolbar-left">
          <button className="toolbar-btn" onClick={openFile} title="Open image">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </button>
          {fileName && <span className="toolbar-filename">{fileName}</span>}
        </div>

        {images.length > 1 && (
          <div className="toolbar-center">
            <button className="toolbar-btn" onClick={() => navigate(-1)} title="Previous (←)">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <span className="toolbar-counter">
              {currentIndex + 1} / {images.length}
            </span>
            <button className="toolbar-btn" onClick={() => navigate(1)} title="Next (→)">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        )}

        <div className="toolbar-right">
          {imageUrl && (
            <div className="zoom-controls">
              <button className="toolbar-btn" onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP * 2))} title="Zoom out">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" />
                </svg>
              </button>
              <span className="zoom-label" onClick={resetView} title="Reset zoom (press 0)">{zoomPercent}%</span>
              <button className="toolbar-btn" onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP * 2))} title="Zoom in">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>

      <div
        ref={imageAreaRef}
        className={areaClass}
        onDoubleClick={handleDoubleClick}
        onPointerDown={panHandlers.handlePointerDown}
        onPointerMove={panHandlers.handlePointerMove}
        onPointerUp={panHandlers.handlePointerUp}
        onPointerLeave={panHandlers.handlePointerUp}
        onPointerCancel={panHandlers.handlePointerUp}
      >
        {error ? (
          <div className="state-message">
            <p className="state-error">{error}</p>
            <p className="state-hint">Use the toolbar button to open another image</p>
          </div>
        ) : imageUrl ? (
          <canvas ref={canvasRef} className="preview-canvas" />
        ) : (
          <div className="state-message">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="state-icon">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <p className="state-text">Click the folder icon to open an image</p>
            <p className="state-hint">Scroll to zoom · Drag to pan · Double-click to reset · ← → to navigate</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
