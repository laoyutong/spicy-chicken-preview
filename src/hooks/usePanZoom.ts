import { useState, useEffect, useCallback, useRef, type MutableRefObject } from "react";
import { clampPan } from "../utils/geometry";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 10;
const ZOOM_STEP = 0.1;

interface UsePanZoomParams {
  imageAreaRef: MutableRefObject<HTMLDivElement | null>;
  imgW: MutableRefObject<number>;
  imgH: MutableRefObject<number>;
}

export function usePanZoom({ imageAreaRef, imgW, imgH }: UsePanZoomParams) {
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [rotation, setRotation] = useState(0); // 0, 90, 180, 270

  const zoomRef = useRef(zoom);
  const panXRef = useRef(panX);
  const panYRef = useRef(panY);
  const rotationRef = useRef(rotation);

  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panXRef.current = panX; }, [panX]);
  useEffect(() => { panYRef.current = panY; }, [panY]);
  useEffect(() => { rotationRef.current = rotation; }, [rotation]);

  // Cache container rect to avoid duplicate getBoundingClientRect() calls
  // (updated by draw() each frame, read by zoomToward() during wheel events)
  const containerRectRef = useRef<{ width: number; height: number } | null>(null);

  const resetView = useCallback(() => {
    zoomRef.current = 1; panXRef.current = 0; panYRef.current = 0;
    setZoom(1); setPanX(0); setPanY(0);
  }, []);

  const zoomToward = useCallback((cx: number, cy: number, step: number) => {
    // Prefer cached rect from draw() to avoid forced layout; fall back to live read
    let cw: number;
    let ch: number;
    if (containerRectRef.current) {
      cw = containerRectRef.current.width;
      ch = containerRectRef.current.height;
    } else {
      const container = imageAreaRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      cw = rect.width;
      ch = rect.height;
    }
    if (cw <= 0 || ch <= 0) return;

    const oldZ = zoomRef.current;
    const newZ = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldZ + step * oldZ));
    if (newZ === oldZ) return;

    const ratio = newZ / oldZ;
    const px = panXRef.current;
    const py = panYRef.current;
    const newPx = (cx - cw / 2) * (1 - ratio) + px * ratio;
    const newPy = (cy - ch / 2) * (1 - ratio) + py * ratio;

    const c = clampPan(newPx, newPy, newZ, imgW.current, imgH.current, cw, ch, rotationRef.current);
    setZoom(newZ);
    setPanX(c.x);
    setPanY(c.y);
  }, [imageAreaRef, imgW, imgH]);

  const rotateClockwise = useCallback(() => {
    setRotation((r) => (r + 90) % 360);
    resetView();
  }, [resetView]);

  const rotateCounterClockwise = useCallback(() => {
    setRotation((r) => (r + 270) % 360);
    resetView();
  }, [resetView]);

  return {
    zoom, setZoom, panX, setPanX, panY, setPanY,
    zoomRef, panXRef, panYRef,
    rotation, setRotation, rotationRef,
    containerRectRef,
    zoomToward, resetView,
    rotateClockwise, rotateCounterClockwise,
    MIN_ZOOM, MAX_ZOOM, ZOOM_STEP,
  };
}
