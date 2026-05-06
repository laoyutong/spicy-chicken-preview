import { useState, useEffect, useCallback, useRef, type MutableRefObject } from "react";
import { invoke } from "@tauri-apps/api/core";

export type SlideshowMode = "forward" | "shuffle";

interface UseSlideshowParams {
  imagesRef: MutableRefObject<string[]>;
  currentIndexRef: MutableRefObject<number>;
  imageCount: number;
  setCurrentIndex: (index: number) => void;
  loadImage: (filePath: string, reset: boolean) => void;
  preloadAdjacent: (index: number) => void;
}

function fisherYatesShuffle(arr: number[]): number[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  // Ensure first element is different from current position if possible
  if (result.length > 1 && result[0] === 0) {
    [result[0], result[1]] = [result[1], result[0]];
  }
  return result;
}

export function useSlideshow({
  imagesRef,
  currentIndexRef,
  imageCount,
  setCurrentIndex,
  loadImage,
  preloadAdjacent,
}: UseSlideshowParams) {
  const [slideshowActive, setSlideshowActive] = useState(false);
  const [slideshowInterval, setSlideshowInterval] = useState(3);
  const [slideshowMode, setSlideshowMode] = useState<SlideshowMode>("forward");
  const [slideshowTick, setSlideshowTick] = useState(0);
  const shuffleHistoryRef = useRef<number[]>([]);  // previously visited indices (stack)
  const shuffleFutureRef = useRef<number[]>([]);    // upcoming indices (queue)

  // Keep refs in sync to avoid stale closures inside setInterval
  const slideshowActiveRef = useRef(slideshowActive);
  useEffect(() => { slideshowActiveRef.current = slideshowActive; }, [slideshowActive]);
  const slideshowIntervalRef = useRef(slideshowInterval);
  useEffect(() => { slideshowIntervalRef.current = slideshowInterval; }, [slideshowInterval]);
  const slideshowModeRef = useRef(slideshowMode);
  useEffect(() => { slideshowModeRef.current = slideshowMode; }, [slideshowMode]);

  const cycleSlideshowInterval = useCallback(() => {
    const intervals = [2, 3, 5, 10];
    const idx = intervals.indexOf(slideshowIntervalRef.current);
    setSlideshowInterval(intervals[(idx + 1) % intervals.length]);
  }, []);

  const cycleSlideshowMode = useCallback(() => {
    setSlideshowMode((m) => (m === "forward" ? "shuffle" : "forward"));
  }, []);

  const toggleSlideshow = useCallback(() => {
    setSlideshowActive((a) => !a);
  }, []);

  const clearShuffleState = useCallback(() => {
    shuffleHistoryRef.current = [];
    shuffleFutureRef.current = [];
  }, []);

  const slideshowAdvance = useCallback((delta: number) => {
    const imgs = imagesRef.current;
    if (imgs.length === 0) return;

    let newIndex: number;
    const mode = slideshowModeRef.current;
    const curIdx = currentIndexRef.current;

    if (mode === "shuffle") {
      if (delta > 0) {
        // Forward: pop from future queue, push current to history stack
        if (shuffleFutureRef.current.length === 0) {
          // Regenerate future order
          const order = fisherYatesShuffle(imgs.map((_, i) => i));
          shuffleFutureRef.current = order.filter((i) => i !== curIdx);
        }
        const next = shuffleFutureRef.current.shift()!;
        shuffleHistoryRef.current.push(curIdx);
        newIndex = next;
      } else {
        // Backward: pop from history stack, push current to front of future queue
        if (shuffleHistoryRef.current.length === 0) {
          // No history — fall back to sequential
          newIndex = (curIdx - 1 + imgs.length) % imgs.length;
        } else {
          const prev = shuffleHistoryRef.current.pop()!;
          shuffleFutureRef.current.unshift(curIdx);
          newIndex = prev;
        }
      }
    } else {
      newIndex = (curIdx + delta + imgs.length) % imgs.length;
    }

    currentIndexRef.current = newIndex;
    setCurrentIndex(newIndex);
    preloadAdjacent(newIndex);
    loadImage(imgs[newIndex], true);
  }, [imagesRef, currentIndexRef, setCurrentIndex, loadImage, preloadAdjacent]);

  const resetSlideshowInterval = useCallback(() => {
    setSlideshowTick((t) => t + 1);
  }, []);

  // Slideshow auto-advance timer
  useEffect(() => {
    if (!slideshowActive || imageCount === 0) return;
    const timer = setInterval(() => {
      slideshowAdvance(1);
    }, slideshowInterval * 1000);
    return () => clearInterval(timer);
  }, [slideshowActive, slideshowInterval, imageCount, slideshowAdvance, slideshowTick]);

  // Prevent display sleep while slideshow is active
  useEffect(() => {
    invoke("keep_awake", { enable: slideshowActive }).catch(() => {});
    return () => {
      if (slideshowActiveRef.current) {
        invoke("keep_awake", { enable: false }).catch(() => {});
      }
    };
  }, [slideshowActive]);

  return {
    slideshowActive,
    setSlideshowActive,
    slideshowInterval,
    setSlideshowInterval,
    slideshowMode,
    setSlideshowMode,
    toggleSlideshow,
    cycleSlideshowInterval,
    cycleSlideshowMode,
    resetSlideshowInterval,
    slideshowAdvance,
    clearShuffleState,
  };
}
