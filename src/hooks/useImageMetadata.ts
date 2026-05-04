import { useState, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { sortImagePaths, filterImagePaths, type SortMode, type FilterMode, type ImageMetaRecord } from "../utils/sorting";

interface UseImageMetadataParams {
  images: string[];
  currentFile: string | null;
  setImages: Dispatch<SetStateAction<string[]>>;
  setCurrentIndex: Dispatch<SetStateAction<number>>;
  unfilteredImagesRef: { current: string[] };
  filterMode: FilterMode;
}

export function useImageMetadata({
  images, currentFile, setImages, setCurrentIndex,
  unfilteredImagesRef, filterMode,
}: UseImageMetadataParams) {
  const [sortBy, setSortBy] = useState<SortMode>("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const imageMetaMapRef = useRef<Map<string, ImageMetaRecord>>(new Map());
  const [metaVersion, setMetaVersion] = useState(0);
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const sortDropdownRef = useRef<HTMLDivElement>(null);

  // Re-sort + re-filter images when sort criteria or metadata changes
  useEffect(() => {
    if (unfilteredImagesRef.current.length === 0) return;
    const currentPath = currentFile;
    const sorted = sortImagePaths(unfilteredImagesRef.current, sortBy, sortOrder, imageMetaMapRef.current);
    unfilteredImagesRef.current = sorted;
    const filtered = filterImagePaths(sorted, filterMode, imageMetaMapRef.current);
    const orderChanged = filtered.some((p, i) => p !== images[i]);
    if (!orderChanged) return;
    setImages(filtered);
    if (currentPath) {
      const newIdx = filtered.indexOf(currentPath);
      if (newIdx >= 0) setCurrentIndex(newIdx);
      else if (filtered.length > 0) { setCurrentIndex(0); }
    }
  }, [sortBy, sortOrder, metaVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch dimensions when sorting by dimensions or aspect-ratio.
  // Always fetch from the unfiltered list so dimensions are cached for filter changes.
  useEffect(() => {
    if (sortBy !== "dimensions" && sortBy !== "aspect-ratio") return;
    if (unfilteredImagesRef.current.length === 0) return;

    const missing = unfilteredImagesRef.current.filter((p) => {
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
      .catch(() => {});

    return () => { cancelled = true; };
  }, [sortBy, images.length]); // eslint-disable-line react-hooks/exhaustive-deps

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

  return {
    sortBy, setSortBy, sortOrder, setSortOrder,
    metaVersion, setMetaVersion,
    sortDropdownOpen, setSortDropdownOpen,
    sortDropdownRef,
    imageMetaMapRef,
  };
}
