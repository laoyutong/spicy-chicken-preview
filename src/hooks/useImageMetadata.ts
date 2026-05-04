import { useState, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { sortImagePaths, type SortMode, type ImageMetaRecord } from "../utils/sorting";

interface UseImageMetadataParams {
  images: string[];
  currentFile: string | null;
  setImages: Dispatch<SetStateAction<string[]>>;
  setCurrentIndex: Dispatch<SetStateAction<number>>;
}

export function useImageMetadata({
  images, currentFile, setImages, setCurrentIndex,
}: UseImageMetadataParams) {
  const [sortBy, setSortBy] = useState<SortMode>("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const imageMetaMapRef = useRef<Map<string, ImageMetaRecord>>(new Map());
  const [metaVersion, setMetaVersion] = useState(0);
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const sortDropdownRef = useRef<HTMLDivElement>(null);

  // Re-sort images when sort criteria or metadata changes
  useEffect(() => {
    if (images.length === 0) return;
    const currentPath = currentFile || images[0] || undefined;
    const sorted = sortImagePaths(images, sortBy, sortOrder, imageMetaMapRef.current);
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
