export type SortMode = "name" | "dimensions" | "aspect-ratio" | "modified";

export interface ImageMetaRecord {
  size: number;
  extension: string;
  modified: number;
  width?: number;
  height?: number;
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

export function sortImagePaths(
  paths: string[],
  mode: SortMode, order: "asc" | "desc",
  metaMap: Map<string, ImageMetaRecord>,
): string[] {
  // Fast-path: backend already sorts by filename ascending
  if (mode === "name" && order === "asc") return paths;
  return [...paths].sort((a, b) => comparePaths(a, b, mode, order, metaMap));
}
