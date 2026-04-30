import { useState, useLayoutEffect, useRef, useMemo, Fragment, type ReactNode } from "react";
import "./Toolbar.css";

/* ── Types ─────────────────────────────────────────────────────── */

export interface ToolbarItemDef {
  id: string;
  section: "left" | "center" | "right";
  /** Lower = more essential, collapses later. 0 = never collapse. */
  priority: number;
  /** Whether this item is currently applicable. False = not rendered at all. */
  condition: boolean;
  renderToolbar: () => ReactNode;
  renderMenu: () => ReactNode;
}

interface ToolbarProps {
  items: ToolbarItemDef[];
  /** Called when overflow set changes — App uses this to auto-close sort dropdown. */
  onOverflowChange?: (overflowIds: Set<string>) => void;
}

/* ── Constants ─────────────────────────────────────────────────── */

const GAP = 4;
const MORE_BTN_WIDTH = 34;
const PADDING = 28; // 14px * 2

/* ── MoreButton ────────────────────────────────────────────────── */

function MoreButton({ overflowItems }: { overflowItems: ToolbarItemDef[] }) {
  return (
    <div className="toolbar-more-btn visible" data-more-btn>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" stroke="none">
        <circle cx="3" cy="8" r="1.5" />
        <circle cx="8" cy="8" r="1.5" />
        <circle cx="13" cy="8" r="1.5" />
      </svg>
      <div className="toolbar-more-menu">
        {overflowItems.map((item) => (
          <Fragment key={item.id}>{item.renderMenu()}</Fragment>
        ))}
      </div>
    </div>
  );
}

/* ── Helpers ───────────────────────────────────────────────────── */

function groupBySection(items: ToolbarItemDef[]) {
  const left: ToolbarItemDef[] = [];
  const center: ToolbarItemDef[] = [];
  const right: ToolbarItemDef[] = [];

  for (const item of items) {
    if (item.section === "left") left.push(item);
    else if (item.section === "center") center.push(item);
    else right.push(item);
  }

  const byPriority = (a: ToolbarItemDef, b: ToolbarItemDef) => a.priority - b.priority;
  left.sort(byPriority);
  center.sort(byPriority);
  right.sort(byPriority);

  return { left, center, right };
}

/* ── Toolbar Component ─────────────────────────────────────────── */

export function Toolbar({ items, onOverflowChange }: ToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [overflowIds, setOverflowIds] = useState<Set<string>>(new Set());
  const [measureVersion, setMeasureVersion] = useState(0);
  const prevOverflowKeyRef = useRef<string>("");

  // Active items (condition === true), memoized
  const activeItems = useMemo(() => items.filter((i) => i.condition), [items]);

  // Grouped + sorted by priority
  const grouped = useMemo(() => groupBySection(activeItems), [activeItems]);

  // ── Measurement + overflow computation ─────────────────────────

  useLayoutEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;

    const measureNodes = el.querySelectorAll("[data-tb-measure-id]");
    const widths = new Map<string, number>();
    measureNodes.forEach((node) => {
      const id = (node as HTMLElement).getAttribute("data-tb-measure-id")!;
      widths.set(id, (node as HTMLElement).offsetWidth);
    });

    const containerWidth = el.clientWidth;
    const overflow = new Set<string>();

    const computeSection = (secItems: ToolbarItemDef[], maxWidth: number) => {
      if (secItems.length === 0) return;

      // Check if all fit
      let total = 0;
      for (let i = 0; i < secItems.length; i++) {
        total += (widths.get(secItems[i].id) ?? 0) + (i > 0 ? GAP : 0);
      }
      if (total <= maxWidth) return;

      // Reserve more button, compute overflow from last item backwards
      let used = MORE_BTN_WIDTH;
      for (let i = 0; i < secItems.length; i++) {
        const w = (widths.get(secItems[i].id) ?? 0) + (i > 0 ? GAP : 0);
        if (used + w <= maxWidth) {
          used += w;
        } else {
          for (let j = i; j < secItems.length; j++) {
            overflow.add(secItems[j].id);
          }
          break;
        }
      }
    };

    const centerWidth = grouped.center.reduce(
      (sum, item, i) => sum + (widths.get(item.id) ?? 0) + (i > 0 ? GAP : 0),
      0,
    );
    const centerGap = grouped.center.length > 0 ? GAP * 2 : 0;
    const availableForSides = containerWidth - PADDING - centerWidth - centerGap;
    const sideWidth = Math.max(0, availableForSides / 2);

    computeSection(grouped.left, sideWidth);
    computeSection(grouped.center, centerWidth);
    computeSection(grouped.right, sideWidth);

    const key = [...overflow].sort().join(",");
    if (key !== prevOverflowKeyRef.current) {
      prevOverflowKeyRef.current = key;
      setOverflowIds(overflow);
      onOverflowChange?.(overflow);
    }
  }, [activeItems, grouped, measureVersion, onOverflowChange]);

  // ── ResizeObserver ─────────────────────────────────────────────

  useLayoutEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => setMeasureVersion((v) => v + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Split items ────────────────────────────────────────────────

  const visible = useMemo(
    () => ({
      left: grouped.left.filter((i) => !overflowIds.has(i.id)),
      center: grouped.center.filter((i) => !overflowIds.has(i.id)),
      right: grouped.right.filter((i) => !overflowIds.has(i.id)),
    }),
    [grouped, overflowIds],
  );

  const overflow = useMemo(
    () => ({
      left: grouped.left.filter((i) => overflowIds.has(i.id)),
      center: grouped.center.filter((i) => overflowIds.has(i.id)),
      right: grouped.right.filter((i) => overflowIds.has(i.id)),
    }),
    [grouped, overflowIds],
  );

  const centerVisible = visible.center.length > 0 || overflow.center.length > 0;

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="toolbar" ref={toolbarRef}>
      {/* Hidden measurement row — always renders ALL active items */}
      <div className="toolbar-measure" aria-hidden="true">
        <div className="toolbar-left">
          {grouped.left.map((item) => (
            <span key={item.id} data-tb-measure-id={item.id}>
              {item.renderToolbar()}
            </span>
          ))}
        </div>
        {grouped.center.length > 0 && (
          <div className="toolbar-center">
            {grouped.center.map((item) => (
              <span key={item.id} data-tb-measure-id={item.id}>
                {item.renderToolbar()}
              </span>
            ))}
          </div>
        )}
        <div className="toolbar-right">
          {grouped.right.map((item) => (
            <span key={item.id} data-tb-measure-id={item.id}>
              {item.renderToolbar()}
            </span>
          ))}
        </div>
      </div>

      {/* Visible toolbar */}
      <div className="toolbar-left">
        {visible.left.map((item) => (
          <Fragment key={item.id}>{item.renderToolbar()}</Fragment>
        ))}
        {overflow.left.length > 0 && <MoreButton overflowItems={overflow.left} />}
      </div>

      {centerVisible && (
        <div className="toolbar-center">
          {visible.center.map((item) => (
            <Fragment key={item.id}>{item.renderToolbar()}</Fragment>
          ))}
          {overflow.center.length > 0 && <MoreButton overflowItems={overflow.center} />}
        </div>
      )}

      <div className="toolbar-right">
        {visible.right.map((item) => (
          <Fragment key={item.id}>{item.renderToolbar()}</Fragment>
        ))}
        {overflow.right.length > 0 && <MoreButton overflowItems={overflow.right} />}
      </div>
    </div>
  );
}
