import { useEffect, useMemo, useRef, useState } from "react";
import { Responsive, WidthProvider, type Layouts } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { usePanelStore } from "../stores/panelStore";
import { Panel } from "../panels/Panel";

const ResponsiveGridLayout = WidthProvider(Responsive);
const BREAKPOINTS = { lg: 1200, md: 800, sm: 480 };
const COLS = { lg: 12, md: 8, sm: 4 };
const LAYOUT_KEY = "layout";

type LayoutItem = {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
};

const LAYOUT_SPECS = {
  lg: { cols: 12, w: 4, h: 4 },
  md: { cols: 8, w: 4, h: 4 },
  sm: { cols: 4, w: 2, h: 3 },
} as const;

function createDefaultItem(id: string, key: keyof typeof LAYOUT_SPECS, index: number): LayoutItem {
  const spec = LAYOUT_SPECS[key];
  const perRow = Math.max(1, Math.floor(spec.cols / spec.w));

  return {
    i: id,
    x: (index % perRow) * spec.w,
    y: Math.floor(index / perRow) * spec.h,
    w: spec.w,
    h: spec.h,
    minW: key === "sm" ? 2 : 3,
    minH: 2,
  };
}

function collides(a: LayoutItem, b: LayoutItem) {
  if (a.i === b.i) return false;
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

function findNextPosition(
  layout: LayoutItem[],
  item: LayoutItem,
  cols: number,
  stepX: number,
  stepY: number
) {
  const maxY = layout.reduce((max, current) => Math.max(max, current.y + current.h), 0);

  for (let y = 0; y <= maxY; y += stepY) {
    for (let x = 0; x <= cols - item.w; x += stepX) {
      const candidate = { ...item, x, y };
      if (!layout.some((placed) => collides(candidate, placed))) {
        return { x, y };
      }
    }
  }

  const nextRowY = Math.ceil(maxY / stepY) * stepY;
  return { x: 0, y: nextRowY };
}

function findPositionNearAnchor(
  layout: LayoutItem[],
  item: LayoutItem,
  cols: number,
  preferredX: number,
  preferredY: number
) {
  const maxY = Math.max(
    preferredY + item.h,
    layout.reduce((max, current) => Math.max(max, current.y + current.h), 0)
  );
  const maxX = cols - item.w;
  const candidateXs = Array.from({ length: maxX + 1 }, (_, x) => x).sort(
    (a, b) => Math.abs(a - preferredX) - Math.abs(b - preferredX)
  );
  const candidateYs = Array.from({ length: maxY + item.h + 1 }, (_, y) => y).sort(
    (a, b) => Math.abs(a - preferredY) - Math.abs(b - preferredY)
  );

  for (const y of candidateYs) {
    for (const x of candidateXs) {
      const candidate = { ...item, x, y };
      if (!layout.some((placed) => collides(candidate, placed))) {
        return { x, y };
      }
    }
  }

  return null;
}

function normalizeSavedItem(
  item: LayoutItem,
  key: keyof typeof LAYOUT_SPECS
): LayoutItem | null {
  const spec = LAYOUT_SPECS[key];
  const minW = key === "sm" ? 2 : 3;
  const minH = 2;

  if (!Number.isFinite(item.x) || !Number.isFinite(item.y) || !Number.isFinite(item.w) || !Number.isFinite(item.h)) {
    return null;
  }

  if (item.w < minW || item.h < minH) {
    return null;
  }

  const width = Math.max(minW, Math.min(item.w, spec.cols));

  return {
    ...item,
    x: Math.max(0, Math.min(item.x, spec.cols - width)),
    y: Math.max(0, item.y),
    w: width,
    h: Math.max(minH, item.h),
    minW,
    minH,
  };
}

function stabilizeLayout(
  layout: LayoutItem[],
  previousLayout: LayoutItem[] | undefined,
  key: keyof typeof LAYOUT_SPECS
) {
  const spec = LAYOUT_SPECS[key];
  const previousById = new Map((previousLayout ?? []).map((item) => [item.i, item]));
  const normalized = layout
    .map((item) => normalizeSavedItem(item, key))
    .filter((item): item is LayoutItem => item !== null)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const placed: LayoutItem[] = [];

  normalized.forEach((item) => {
    const previous = previousById.get(item.i);
    const preferredX = previous ? Math.min(previous.x, spec.cols - item.w) : item.x;
    const preferredY = previous?.y ?? item.y;
    const keepCurrent = !placed.some((placedItem) => collides(item, placedItem));

    if (keepCurrent) {
      placed.push(item);
      return;
    }

    const nextPosition = findPositionNearAnchor(placed, item, spec.cols, preferredX, preferredY);

    placed.push(
      nextPosition
        ? {
            ...item,
            x: nextPosition.x,
            y: nextPosition.y,
          }
        : item
    );
  });

  return placed;
}

function reconcileLayouts(panelIds: string[], sourceLayouts?: Layouts): Layouts {
  return (Object.keys(LAYOUT_SPECS) as Array<keyof typeof LAYOUT_SPECS>).reduce<Layouts>((acc, key) => {
    const spec = LAYOUT_SPECS[key];
    const existing = (sourceLayouts?.[key] as LayoutItem[] | undefined) ?? [];
    const existingById = new Map(existing.map((item) => [item.i, item]));
    const nextLayout: LayoutItem[] = [];

    panelIds.forEach((id, index) => {
      const saved = existingById.get(id);
      const normalizedSaved = saved ? normalizeSavedItem(saved, key) : null;

      if (normalizedSaved && !nextLayout.some((placed) => collides(normalizedSaved, placed))) {
        nextLayout.push(normalizedSaved);
        return;
      }

      const fallback = createDefaultItem(id, key, index);
      const nextPosition = findNextPosition(nextLayout, fallback, spec.cols, spec.w, spec.h);

      nextLayout.push({
        ...fallback,
        x: nextPosition.x,
        y: nextPosition.y,
      });
    });

    acc[key] = nextLayout;
    return acc;
  }, {});
}

function readSavedLayouts(): Layouts {
  try {
    return JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "{}") as Layouts;
  } catch {
    return {};
  }
}

export function PanelGrid() {
  const { panels, removePanel } = usePanelStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const panelIds = useMemo(() => panels.map((panel) => panel.id), [panels]);
  const [currentLayouts, setCurrentLayouts] = useState<Layouts>(() => reconcileLayouts(panelIds, readSavedLayouts()));

  useEffect(() => {
    setCurrentLayouts((prev) => reconcileLayouts(panelIds, prev));
  }, [panelIds]);

  useEffect(() => {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(currentLayouts));
  }, [currentLayouts]);
  const marginY = 8;

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        height: "100%",
        minHeight: 0,
        padding: 8,
        overflowX: "hidden",
        overflowY: "auto",
        background: "var(--color-surface-dark)",
      }}
    >
      <ResponsiveGridLayout
        layouts={currentLayouts}
        breakpoints={BREAKPOINTS}
        cols={COLS}
        rowHeight={100}
        margin={[8, marginY]}
        containerPadding={[0, 0]}
        draggableHandle=".panel-header"
        draggableCancel=".panel-close-btn,.panel-close-btn *,.panel-header-action,.panel-header-action *"
        isBounded
        compactType="vertical"
        preventCollision={false}
        resizeHandles={["n", "s", "e", "w", "ne", "nw", "se", "sw"]}
        onLayoutChange={(_, allLayouts) => {
          const stabilizedLayouts = (Object.keys(LAYOUT_SPECS) as Array<keyof typeof LAYOUT_SPECS>).reduce<Layouts>(
            (acc, key) => {
              acc[key] = stabilizeLayout(
                (allLayouts[key] as LayoutItem[] | undefined) ?? [],
                currentLayouts[key] as LayoutItem[] | undefined,
                key
              );
              return acc;
            },
            {}
          );
          const nextLayouts = reconcileLayouts(panelIds, stabilizedLayouts);
          setCurrentLayouts(nextLayouts);
          localStorage.setItem(LAYOUT_KEY, JSON.stringify(nextLayouts));
        }}
        useCSSTransforms={false}
      >
        {panels.map((panel) => (
          <div key={panel.id}>
            <Panel
              id={panel.id}
              title={panel.title}
              type={panel.type}
              onClose={() => removePanel(panel.id)}
            />
          </div>
        ))}
      </ResponsiveGridLayout>
    </div>
  );
}
