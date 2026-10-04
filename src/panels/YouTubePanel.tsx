import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, ArrowRight, RotateCw } from "lucide-react";
import { usePanelStore } from "../stores/panelStore";

interface Props {
  panelId: string;
}

const WEBVIEW_EDGE_INSET = 1;

type Bounds = {
  x: number;
  y: number;
  w: number;
  h: number;
};

function boundsEqual(a: Bounds | null, b: Bounds | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

export function YouTubePanel({ panelId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
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
  const [hovered, setHovered] = useState(false);
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updatePanelTitle = usePanelStore((s) => s.updatePanelTitle);

  const getWindowAdjustedBounds = useCallback((): Bounds | null => {
    const el = containerRef.current;
    if (!el) return null;

    const rect = el.getBoundingClientRect();
    const left = Math.max(0, rect.left + WEBVIEW_EDGE_INSET);
    const top = Math.max(0, rect.top + WEBVIEW_EDGE_INSET);
    const right = Math.min(window.innerWidth, rect.right - WEBVIEW_EDGE_INSET);
    const bottom = Math.min(window.innerHeight, rect.bottom - WEBVIEW_EDGE_INSET);

    if (right - left < 2 || bottom - top < 2) {
      return null;
    }

    return {
      x: left,
      y: top,
      w: right - left,
      h: bottom - top,
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
      if (!bounds || bounds.w < 40 || bounds.h < 40) {
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

        if (!bounds || isScrollingRef.current) {
          lastAppliedBoundsRef.current = null;
          if (webviewVisibleRef.current) {
            await invoke("yt_hide", { panelId });
            webviewVisibleRef.current = false;
          }
          continue;
        }

        if (boundsEqual(lastAppliedBoundsRef.current, bounds)) {
          continue;
        }

        await invoke("yt_set_bounds", {
          panelId,
          x: bounds.x,
          y: bounds.y,
          width: bounds.w,
          height: bounds.h,
        });
        lastAppliedBoundsRef.current = bounds;

        if (!webviewVisibleRef.current) {
          await invoke("yt_show", { panelId });
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
  }, [panelId]);

  const syncBounds = useCallback(() => {
    desiredBoundsRef.current = getWindowAdjustedBounds();
    void flushBounds();
  }, [flushBounds, getWindowAdjustedBounds]);

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

    const el = containerRef.current;
    if (el) {
      resizeObserver.observe(el);
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
        await invoke("yt_open", {
          panelId,
          x: bounds.x,
          y: bounds.y,
          width: bounds.w,
          height: bounds.h,
        });
        desiredBoundsRef.current = bounds;
        lastAppliedBoundsRef.current = null;
        await flushBounds();

        if (!cancelled && openSequenceRef.current === sequence) {
          setOpened(true);
        }
      } catch (e: unknown) {
        if (!cancelled && openSequenceRef.current === sequence) {
          setError(String(e));
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
      invoke("yt_close", { panelId }).catch(() => {});
    };
  }, [flushBounds, panelId, waitForStableBounds]);

  useEffect(() => {
    if (!opened) return;

    let alive = true;
    let lastTitle = "";

    const syncTitle = async () => {
      try {
        const title = await invoke<string>("yt_get_title", { panelId });
        const normalized = title.trim();
        if (!alive || !normalized || normalized === lastTitle) return;
        lastTitle = normalized;
        updatePanelTitle(panelId, normalized);
      } catch {
        // ignore title polling failures
      }
    };

    void syncTitle();
    const interval = window.setInterval(() => {
      void syncTitle();
    }, 1500);

    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, [opened, panelId, updatePanelTitle]);

  const handleBack = () => invoke("yt_back", { panelId }).catch(() => {});
  const handleForward = () => invoke("yt_forward", { panelId }).catch(() => {});
  const handleReload = () => invoke("yt_reload", { panelId }).catch(() => {});

  return (
    <div
      ref={containerRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        background: "var(--color-surface-dark-soft)",
      }}
    >
      {!opened && !error && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--color-on-dark-soft)",
            fontSize: 12,
            fontFamily: "var(--font-sans)",
          }}
        >
          Chargement YouTube…
        </div>
      )}

      {error && (
        <div
          style={{
            position: "absolute",
            inset: 0,
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
          <span>Impossible d'ouvrir YouTube</span>
          <span style={{ opacity: 0.6, fontSize: 11 }}>{error}</span>
        </div>
      )}

      <div
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          gap: 2,
          background: "rgba(37,35,32,0.80)",
          backdropFilter: "blur(8px)",
          borderRadius: 9999,
          padding: "4px 6px",
          opacity: hovered ? 0.7 : 0,
          transition: "opacity 150ms ease-out",
          pointerEvents: hovered ? "auto" : "none",
        }}
      >
        <NavButton onClick={handleBack} title="Précédent">
          <ArrowLeft size={14} strokeWidth={1.5} />
        </NavButton>
        <NavButton onClick={handleForward} title="Suivant">
          <ArrowRight size={14} strokeWidth={1.5} />
        </NavButton>
        <NavButton onClick={handleReload} title="Recharger">
          <RotateCw size={14} strokeWidth={1.5} />
        </NavButton>
      </div>
    </div>
  );
}

interface NavButtonProps {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}

function NavButton({ onClick, title, children }: NavButtonProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: "3px 5px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--color-on-dark-soft)",
        borderRadius: 6,
        transition: "color 150ms ease-out",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.color = "var(--color-on-dark)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.color = "var(--color-on-dark-soft)";
      }}
    >
      {children}
    </button>
  );
}
