import { useState, useEffect, useCallback, useRef, type MutableRefObject } from "react";

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
  const shuffleOrderRef = useRef<number[]>([]);

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

  const slideshowAdvance = useCallback(() => {
    const imgs = imagesRef.current;
    if (imgs.length === 0) return;

    let newIndex: number;
    const mode = slideshowModeRef.current;

    if (mode === "shuffle") {
      // Regenerate shuffle order when reaching the end, or on first use
      let order = shuffleOrderRef.current;
      if (order.length !== imgs.length) {
        order = fisherYatesShuffle(imgs.map((_, i) => i));
        // Start from current position
        const curPos = order.indexOf(currentIndexRef.current);
        if (curPos >= 0) {
          order = [...order.slice(curPos + 1), ...order.slice(0, curPos)];
        }
        shuffleOrderRef.current = order;
      }
      newIndex = order.shift()!;
      if (order.length === 0) {
        shuffleOrderRef.current = [];
      }
    } else {
      newIndex = (currentIndexRef.current + 1) % imgs.length;
    }

    currentIndexRef.current = newIndex;
    setCurrentIndex(newIndex);
    preloadAdjacent(newIndex);
    loadImage(imgs[newIndex], true);
  }, [imagesRef, currentIndexRef, setCurrentIndex, loadImage, preloadAdjacent]);

  // Slideshow auto-advance timer
  useEffect(() => {
    if (!slideshowActive || imageCount === 0) return;
    const timer = setInterval(() => {
      slideshowAdvance();
    }, slideshowInterval * 1000);
    return () => clearInterval(timer);
  }, [slideshowActive, slideshowInterval, imageCount, slideshowAdvance]);

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
  };
}
