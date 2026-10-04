import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { DEFAULT_BROWSER_URL, usePanelStore } from "../stores/panelStore";
import { normalizeBrowserInput } from "./browserUtils";

interface Props {
  panelId: string;
}

type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type BrowserStateEvent = {
  panelId: string;
  url: string;
  title: string;
};

const WEBVIEW_EDGE_INSET = 1;

function boundsEqual(a: Bounds | null, b: Bounds | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function BrowserPanel({ panelId }: Props) {
  const viewportFrameRef = useRef<HTMLDivElement>(null);
  const loopRef = useRef<number>(0);
  const openSequenceRef = useRef(0);
  const openRetryRef = useRef<number | null>(null);
  const scrollStopRef = useRef<number | null>(null);
  const syncInFlightRef = useRef(false);
  const syncQueuedRef = useRef(false);
  const isScrollingRef = useRef(false);
  const desiredBoundsRef = useRef<Bounds | null>(null);
  const lastAppliedBoundsRef = useRef<Bounds | null>(null);
  const webviewVisibleRef = useRef(false);
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settingsOpen = usePanelStore((s) => s.settingsOpen);
  const browserUrl = usePanelStore(
    (s) => s.panels.find((panel) => panel.id === panelId)?.meta?.browserState?.url ?? DEFAULT_BROWSER_URL
  );
  const currentUrlRef = useRef(browserUrl);
  const updatePanelMeta = usePanelStore((s) => s.updatePanelMeta);

  useEffect(() => {
    currentUrlRef.current = browserUrl;
  }, [browserUrl]);

  const getWindowAdjustedBounds = useCallback((): Bounds | null => {
    const viewport = viewportFrameRef.current;
    if (!viewport) return null;

    const viewportRect = viewport.getBoundingClientRect();
    const left = Math.max(0, viewportRect.left + WEBVIEW_EDGE_INSET);
    const top = Math.max(0, viewportRect.top + WEBVIEW_EDGE_INSET);
    const right = Math.min(window.innerWidth, viewportRect.right - WEBVIEW_EDGE_INSET);
    const bottom = Math.min(window.innerHeight, viewportRect.bottom - WEBVIEW_EDGE_INSET);

    if (right - left < 2 || bottom - top < 2) {
      return null;
    }

    return {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    };
  }, []);

  const nextFrame = useCallback(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      }),
    []
  );

  const waitForStableBounds = useCallback(async () => {
    let previous: Bounds | null = null;
    let stableCount = 0;

    for (let i = 0; i < 12; i += 1) {
      await nextFrame();
      const bounds = getWindowAdjustedBounds();
      if (!bounds || bounds.width < 40 || bounds.height < 40) {
        previous = bounds;
        stableCount = 0;
        continue;
      }

      if (boundsEqual(previous, bounds)) {
        stableCount += 1;
      } else {
        stableCount = 0;
      }

      previous = bounds;
      if (stableCount >= 1) {
        return bounds;
      }
    }

    return previous;
  }, [getWindowAdjustedBounds, nextFrame]);

  const flushBounds = useCallback(async () => {
    if (syncInFlightRef.current) {
      syncQueuedRef.current = true;
      return;
    }

    syncInFlightRef.current = true;
    try {
      do {
        syncQueuedRef.current = false;
        const bounds = desiredBoundsRef.current;

        if (!bounds || settingsOpen || isScrollingRef.current) {
          lastAppliedBoundsRef.current = null;
          if (webviewVisibleRef.current) {
            await invoke("hide_browser_webview", { panelId });
            webviewVisibleRef.current = false;
          }
          continue;
        }

        if (!boundsEqual(lastAppliedBoundsRef.current, bounds)) {
          await invoke("resize_browser_webview", { panelId, bounds });
          lastAppliedBoundsRef.current = bounds;
        }

        if (!webviewVisibleRef.current) {
          await invoke("show_browser_webview", { panelId });
          webviewVisibleRef.current = true;
        }
      } while (syncQueuedRef.current);
    } catch {
      // ignore races while the native child webview is opening or closing
    } finally {
      syncInFlightRef.current = false;
      if (syncQueuedRef.current) {
        void flushBounds();
      }
    }
  }, [panelId, settingsOpen]);

  const syncBounds = useCallback(() => {
    desiredBoundsRef.current = settingsOpen ? null : getWindowAdjustedBounds();
    void flushBounds();
  }, [flushBounds, getWindowAdjustedBounds, settingsOpen]);

  const beginScroll = useCallback(() => {
    isScrollingRef.current = true;
    if (scrollStopRef.current !== null) {
      window.clearTimeout(scrollStopRef.current);
    }
    scrollStopRef.current = window.setTimeout(() => {
      isScrollingRef.current = false;
      scrollStopRef.current = null;
      syncBounds();
    }, 120);
    void flushBounds();
  }, [flushBounds, syncBounds]);

  useEffect(() => {
    let alive = true;

    const loop = () => {
      if (!alive) return;
      syncBounds();
      loopRef.current = requestAnimationFrame(loop);
    };

    loopRef.current = requestAnimationFrame(loop);

    const handleResize = () => syncBounds();
    const handleScroll = () => beginScroll();
    const resizeObserver = new ResizeObserver(() => syncBounds());
    const element = viewportFrameRef.current;

    if (element) {
      resizeObserver.observe(element);
    }

    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, true);

    return () => {
      alive = false;
      cancelAnimationFrame(loopRef.current);
      if (scrollStopRef.current !== null) {
        window.clearTimeout(scrollStopRef.current);
      }
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [syncBounds]);

  useEffect(() => {
    let cancelled = false;
    const sequence = openSequenceRef.current + 1;
    openSequenceRef.current = sequence;

    const open = async () => {
      setOpened(false);
      setError(null);

      const bounds = await waitForStableBounds();
      if (cancelled || openSequenceRef.current !== sequence) return;

      if (!bounds) {
        openRetryRef.current = window.setTimeout(() => {
          void open();
        }, 250);
        return;
      }

      try {
        await invoke("create_browser_webview", {
          panelId,
          url: normalizeBrowserInput(currentUrlRef.current),
          bounds,
        });
        desiredBoundsRef.current = bounds;
        lastAppliedBoundsRef.current = null;
        await flushBounds();

        if (!cancelled && openSequenceRef.current === sequence) {
          setOpened(true);
        }
      } catch (reason: unknown) {
        if (!cancelled && openSequenceRef.current === sequence) {
          setError(String(reason));
        }
      }
    };

    void open();

    return () => {
      cancelled = true;
      if (openRetryRef.current !== null) {
        window.clearTimeout(openRetryRef.current);
      }
      openSequenceRef.current += 1;
      desiredBoundsRef.current = null;
      lastAppliedBoundsRef.current = null;
      webviewVisibleRef.current = false;
      invoke("destroy_browser_webview", { panelId }).catch(() => {});
    };
  }, [flushBounds, panelId, waitForStableBounds]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void listen<BrowserStateEvent>("browser://state", (event) => {
      if (event.payload.panelId !== panelId) return;

      const nextUrl = event.payload.url || DEFAULT_BROWSER_URL;
      updatePanelMeta(panelId, {
        browserState: { url: nextUrl },
        initialUrl: nextUrl,
      });
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [panelId, updatePanelMeta]);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "var(--color-surface-dark-soft)",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          minHeight: 0,
          padding: "22px 10px 10px",
          borderRadius: 12,
          background: "linear-gradient(180deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.015) 100%)",
        }}
      >
        <div
          ref={viewportFrameRef}
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            borderRadius: 10,
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(0,0,0,0.18)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
          }}
        />

        {!opened && !error && (
          <div
            style={{
              position: "absolute",
              inset: "22px 10px 10px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--color-on-dark-soft)",
              fontSize: 12,
              fontFamily: "var(--font-sans)",
            }}
          >
            Chargement du navigateur…
          </div>
        )}

        {error && (
          <div
            style={{
              position: "absolute",
              inset: "22px 10px 10px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              color: "var(--color-error)",
              fontSize: 12,
              fontFamily: "var(--font-sans)",
              padding: 16,
              textAlign: "center",
            }}
          >
            <span>Impossible d&apos;ouvrir cette page</span>
            <span style={{ opacity: 0.7, fontSize: 11 }}>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}
