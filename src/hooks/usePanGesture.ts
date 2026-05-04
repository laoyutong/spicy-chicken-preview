import { useState, useEffect, useRef, useCallback, type Dispatch, type SetStateAction, type MutableRefObject } from "react";
import { clampPan } from "../utils/geometry";

const PAN_DEAD_ZONE = 3;

interface UsePanGestureParams {
  imageAreaRef: MutableRefObject<HTMLDivElement | null>;
  zoomRef: MutableRefObject<number>;
  panXRef: MutableRefObject<number>;
  panYRef: MutableRefObject<number>;
  rotationRef: MutableRefObject<number>;
  imgW: MutableRefObject<number>;
  imgH: MutableRefObject<number>;
  setPanX: Dispatch<SetStateAction<number>>;
  setPanY: Dispatch<SetStateAction<number>>;
  zoomToward: (cx: number, cy: number, step: number) => void;
}

export function usePanGesture({
  imageAreaRef, zoomRef, panXRef, panYRef, rotationRef,
  imgW, imgH, setPanX, setPanY, zoomToward,
}: UsePanGestureParams) {
  const [dragging, setDragging] = useState(false);
  const isPanning = useRef(false);
  const hasPanned = useRef(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const velocitySamples = useRef<{ x: number; y: number; t: number }[]>([]);
  const momentumRaf = useRef(0);

  // Wheel: zoom (pinch) or pan (scroll)
  useEffect(() => {
    const el = imageAreaRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (isPanning.current) return;
      if (!imageAreaRef.current) return;
      e.preventDefault();

      const isPinch = e.ctrlKey || e.metaKey;
      if (isPinch) {
        const step = e.deltaY > 0 ? -0.1 : 0.1;
        zoomToward(e.clientX, e.clientY, step);
      } else {
        if (momentumRaf.current) { cancelAnimationFrame(momentumRaf.current); momentumRaf.current = 0; }
        const rect = imageAreaRef.current.getBoundingClientRect();
        const newX = panXRef.current - e.deltaX;
        const newY = panYRef.current - e.deltaY;
        const c = clampPan(newX, newY, zoomRef.current, imgW.current, imgH.current, rect.width, rect.height, rotationRef.current);
        setPanX(c.x);
        setPanY(c.y);
      }
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [imageAreaRef, zoomRef, panXRef, panYRef, rotationRef, imgW, imgH, setPanX, setPanY, zoomToward]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
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
  }, [imageAreaRef, panXRef, panYRef]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
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
    const c = clampPan(newX, newY, zoomRef.current, imgW.current, imgH.current, rect.width, rect.height, rotationRef.current);
    setPanX(c.x);
    setPanY(c.y);
  }, [imageAreaRef, zoomRef, imgW, imgH, rotationRef, setPanX, setPanY]);

  const handlePointerUp = useCallback(() => {
    if (!isPanning.current) return;
    isPanning.current = false;
    hasPanned.current = false;
    setDragging(false);

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
            const c = clampPan(nx, ny, z, imgW.current, imgH.current, rect.width, rect.height, rotationRef.current);
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
  }, [imageAreaRef, zoomRef, panXRef, panYRef, imgW, imgH, rotationRef, setPanX, setPanY]);

  // Cancel momentum on unmount
  useEffect(() => {
    return () => {
      if (momentumRaf.current) cancelAnimationFrame(momentumRaf.current);
    };
  }, []);

  return {
    dragging,
    momentumRaf,
    panHandlers: {
      handlePointerDown, handlePointerMove, handlePointerUp,
    },
  };
}
