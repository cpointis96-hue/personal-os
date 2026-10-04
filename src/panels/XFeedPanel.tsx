import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ChevronDown, Plus, RefreshCw, Search, Settings } from "lucide-react";
import { lists } from "../lib/db/lists";
import type { XList, XTweet } from "../types/db";
import { usePanelStore } from "../stores/panelStore";
import { settings } from "../lib/db/settings";

// ── helpers ────────────────────────────────────────────────────────────────

function relativeTime(ts: number | null): string {
  if (!ts) return "";
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return "maintenant";
  if (diff < 3600) return `${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}j`;
  return `${Math.floor(diff / 86400 / 30)}mo`;
}

function handleColor(handle: string): string {
  let h = 0;
  for (let i = 0; i < handle.length; i++) h = (h * 31 + handle.charCodeAt(i)) & 0xfffffff;
  const hue = h % 360;
  return `hsl(${hue}, 35%, 38%)`;
}

function Avatar({ handle }: { handle: string }) {
  const letter = (handle[0] ?? "?").toUpperCase();
  return (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: "50%",
        background: handleColor(handle),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        fontSize: 12,
        fontFamily: "var(--font-sans)",
        fontWeight: 600,
        color: "rgba(255,255,255,0.85)",
        userSelect: "none",
      }}
    >
      {letter}
    </div>
  );
}

type MediaItem = { url?: string; _type?: string; filename?: string };

function TweetMedia({ mediaJson }: { mediaJson: string }) {
  let items: MediaItem[] = [];
  try {
    const parsed = JSON.parse(mediaJson);
    if (Array.isArray(parsed)) items = parsed;
    else if (typeof parsed === "object" && parsed !== null) items = [parsed];
  } catch {
    return null;
  }

  const images = items.filter(
    (m) =>
      m.url &&
      (m._type === "photo" ||
        /\.(jpe?g|png|gif|webp)(\?|$)/i.test(m.url ?? ""))
  );

  if (images.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
      {images.slice(0, 4).map((img, i) => (
        <img
          key={i}
          src={img.url}
          alt=""
          loading="lazy"
          style={{
            maxWidth: "100%",
            borderRadius: 6,
            display: "block",
            objectFit: "cover",
            maxHeight: 240,
          }}
          onError={(e) => {
            (e.currentTarget as HTMLElement).style.display = "none";
          }}
        />
      ))}
    </div>
  );
}

// ── TweetCard ──────────────────────────────────────────────────────────────

interface TweetCardProps {
  tweet: XTweet;
  onFactCheck: (tweet: XTweet) => void;
}

function TweetCard({ tweet, onFactCheck }: TweetCardProps) {
  const [hovered, setHovered] = useState(false);

  const handle = tweet.author_handle ?? "unknown";
  const raw = tweet.raw_json ? (() => {
    try { return JSON.parse(tweet.raw_json!); } catch { return null; }
  })() : null;
  const replies = raw?.reply_count ?? raw?.retweet_count ? null : null;
  const rtCount = raw?.retweet_count ?? null;
  const likeCount = raw?.like_count ?? null;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: "10px 12px",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        display: "flex",
        gap: 10,
        position: "relative",
        transition: "background var(--duration-fast)",
        background: hovered ? "rgba(255,255,255,0.025)" : "transparent",
      }}
    >
      <Avatar handle={handle} />

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* author row */}
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 6,
            marginBottom: 3,
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontFamily: "var(--font-sans)",
              fontWeight: 600,
              color: "var(--color-on-dark)",
              flexShrink: 0,
            }}
          >
            {handle}
          </span>
          <span
            style={{
              fontSize: 11,
              fontFamily: "var(--font-sans)",
              color: "var(--color-on-dark-soft)",
              opacity: 0.6,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            @{handle}
          </span>
          <span
            style={{
              fontSize: 11,
              fontFamily: "var(--font-sans)",
              color: "var(--color-on-dark-soft)",
              opacity: 0.4,
              marginLeft: "auto",
              flexShrink: 0,
            }}
          >
            {relativeTime(tweet.created_at)}
          </span>
        </div>

        {/* text */}
        {tweet.text && (
          <p
            style={{
              fontSize: 12,
              fontFamily: "var(--font-sans)",
              color: "var(--color-on-dark)",
              lineHeight: 1.55,
              margin: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {tweet.text}
          </p>
        )}

        {/* media */}
        {tweet.media_json && <TweetMedia mediaJson={tweet.media_json} />}

        {/* footer */}
        {(rtCount !== null || likeCount !== null) && (
          <div
            style={{
              display: "flex",
              gap: 14,
              marginTop: 6,
              fontSize: 11,
              fontFamily: "var(--font-sans)",
              color: "var(--color-on-dark-soft)",
              opacity: 0.45,
            }}
          >
            {replies !== null && <span>💬 {replies}</span>}
            {rtCount !== null && <span>🔁 {rtCount}</span>}
            {likeCount !== null && <span>♡ {likeCount}</span>}
          </div>
        )}
      </div>

      {/* fact-check button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onFactCheck(tweet);
        }}
        title="Fact-check ce tweet"
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--color-on-dark-soft)",
          padding: 4,
          display: "flex",
          alignItems: "center",
          opacity: hovered ? 0.6 : 0,
          transition: "opacity var(--duration-fast)",
          borderRadius: 4,
        }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = "1")}
        onMouseLeave={(e) =>
          ((e.currentTarget as HTMLElement).style.opacity = hovered ? "0.6" : "0")
        }
      >
        <Search size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
}

// ── ListCombobox ───────────────────────────────────────────────────────────

interface ListComboboxProps {
  allLists: XList[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onManage: () => void;
}

function ListCombobox({ allLists, selectedId, onSelect, onManage }: ListComboboxProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = allLists.find((l) => l.id === selectedId);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          background: "rgba(255,255,255,0.07)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 6,
          padding: "3px 8px 3px 10px",
          cursor: "pointer",
          color: "var(--color-on-dark)",
          fontFamily: "var(--font-sans)",
          fontSize: 12,
          whiteSpace: "nowrap",
          maxWidth: 180,
          overflow: "hidden",
          textOverflow: "ellipsis",
          transition: "background var(--duration-fast), border-color var(--duration-fast)",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.1)";
          (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.15)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.07)";
          (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.1)";
        }}
      >
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
          {selected?.name ?? "Choisir une liste"}
        </span>
        <ChevronDown
          size={12}
          strokeWidth={1.5}
          style={{
            flexShrink: 0,
            opacity: 0.5,
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 150ms ease",
          }}
        />
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            background: "var(--color-surface-dark-elevated)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
            padding: "4px 0",
            minWidth: 180,
            zIndex: 100,
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          }}
        >
          {allLists.length === 0 && (
            <div
              style={{
                padding: "6px 12px",
                fontSize: 11,
                color: "var(--color-on-dark-soft)",
                opacity: 0.5,
                fontFamily: "var(--font-sans)",
              }}
            >
              Aucune liste
            </div>
          )}
          {allLists.map((list) => (
            <button
              key={list.id}
              onClick={() => {
                onSelect(list.id);
                setOpen(false);
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: list.id === selectedId ? "rgba(204,120,92,0.15)" : "none",
                border: "none",
                padding: "6px 12px",
                cursor: "pointer",
                color: list.id === selectedId ? "var(--color-primary)" : "var(--color-on-dark)",
                fontFamily: "var(--font-sans)",
                fontSize: 12,
                transition: "background var(--duration-fast)",
              }}
              onMouseEnter={(e) => {
                if (list.id !== selectedId)
                  (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)";
              }}
              onMouseLeave={(e) => {
                if (list.id !== selectedId)
                  (e.currentTarget as HTMLElement).style.background = "none";
              }}
            >
              {list.name}
            </button>
          ))}

          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", margin: "4px 0" }} />
          <button
            onClick={() => {
              onManage();
              setOpen(false);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              width: "100%",
              textAlign: "left",
              background: "none",
              border: "none",
              padding: "6px 12px",
              cursor: "pointer",
              color: "var(--color-on-dark-soft)",
              fontFamily: "var(--font-sans)",
              fontSize: 12,
              transition: "background var(--duration-fast)",
              opacity: 0.7,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)";
              (e.currentTarget as HTMLElement).style.opacity = "1";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "none";
              (e.currentTarget as HTMLElement).style.opacity = "0.7";
            }}
          >
            <Plus size={12} strokeWidth={1.5} />
            Gérer les listes
          </button>
        </div>
      )}
    </div>
  );
}

// ── XFeedPanel ─────────────────────────────────────────────────────────────

const BATCH = 30;

interface Props {
  panelId: string;
}

export function XFeedPanel({ panelId }: Props) {
  const updatePanelMeta = usePanelStore((s) => s.updatePanelMeta);
  const openFactCheckChat = usePanelStore((s) => s.openFactCheckChat);
  const setSettingsOpen = usePanelStore((s) => s.setSettingsOpen);
  const panelMeta = usePanelStore((s) => s.panels.find((p) => p.id === panelId)?.meta);

  const [allLists, setAllLists] = useState<XList[]>([]);
  const [selectedListId, setSelectedListId] = useState<number | null>(
    panelMeta?.selectedListId ?? null
  );
  const [tweetItems, setTweetItems] = useState<XTweet[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [scraping, setScaping] = useState(false);

  // control bar visibility
  const [barVisible, setBarVisible] = useState(true);
  const lastScrollY = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // pull-to-refresh
  const dragStartY = useRef<number | null>(null);
  const [pullDist, setPullDist] = useState(0);
  const PULL_THRESHOLD = 60;

  // load lists on mount
  useEffect(() => {
    lists.getAll().then(setAllLists);
  }, []);

  // listen for scrape events
  useEffect(() => {
    const unsubs: Array<() => void> = [];
    listen("x://scrape-start", () => setScaping(true)).then((u) => unsubs.push(u));
    listen("x://done", () => {
      setScaping(false);
      // reload tweets after scrape
      if (selectedListId !== null) {
        loadTweets(selectedListId, 0, true);
      }
    }).then((u) => unsubs.push(u));
    return () => unsubs.forEach((u) => u());
  }, [selectedListId]);

  // load tweets
  const loadTweets = useCallback(
    async (listId: number, off: number, reset = false) => {
      if (loadingMore && !reset) return;
      setLoadingMore(true);
      try {
        const batch = await lists.getXFeed(listId, BATCH, off);
        if (reset) {
          setTweetItems(batch);
        } else {
          setTweetItems((prev) => [...prev, ...batch]);
        }
        setOffset(off + batch.length);
        setHasMore(batch.length === BATCH);
      } finally {
        setLoadingMore(false);
      }
    },
    [loadingMore]
  );

  // when selectedListId changes
  useEffect(() => {
    if (selectedListId === null) {
      setTweetItems([]);
      setOffset(0);
      setHasMore(false);
      return;
    }
    updatePanelMeta(panelId, { selectedListId });
    setOffset(0);
    setHasMore(true);
    loadTweets(selectedListId, 0, true);
  }, [selectedListId]);

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && selectedListId !== null) {
          loadTweets(selectedListId, offset);
        }
      },
      { root: scrollRef.current, threshold: 0.1 }
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [hasMore, loadingMore, offset, selectedListId, loadTweets]);

  // scroll handler for auto-hide bar
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const y = el.scrollTop;
    if (y < lastScrollY.current - 5 || y < 10) {
      setBarVisible(true);
    } else if (y > lastScrollY.current + 5) {
      setBarVisible(false);
    }
    lastScrollY.current = y;
  }, []);

  // pull-to-refresh handlers (pointer events for desktop)
  const handlePointerDown = (e: React.PointerEvent) => {
    const el = scrollRef.current;
    if (!el || el.scrollTop > 0) return;
    dragStartY.current = e.clientY;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (dragStartY.current === null) return;
    const el = scrollRef.current;
    if (!el || el.scrollTop > 0) {
      dragStartY.current = null;
      setPullDist(0);
      return;
    }
    const dist = Math.max(0, e.clientY - dragStartY.current);
    setPullDist(Math.min(dist, PULL_THRESHOLD * 1.5));
  };

  const handlePointerUp = async () => {
    if (dragStartY.current === null) return;
    dragStartY.current = null;

    if (pullDist >= PULL_THRESHOLD && selectedListId !== null) {
      setPullDist(0);
      // get member handles and scrape
      try {
        const members = await lists.getMembers(selectedListId);
        const handles = members.map((p) => p.handle);
        if (handles.length > 0) {
          await invoke("x_scrape_all", { handles });
        }
      } catch {
        // scrape failed silently
      }
    } else {
      setPullDist(0);
    }
  };

  const handleFactCheck = async (tweet: XTweet) => {
    const factCheckPrompt = await settings.get<string>("fact_check_prompt");
    openFactCheckChat({
      tweetText: tweet.text ?? "",
      authorHandle: tweet.author_handle ?? "unknown",
      systemPrompt: factCheckPrompt ?? undefined,
    });
  };

  const pullProgress = Math.min(pullDist / PULL_THRESHOLD, 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", position: "relative" }}>
      {/* scraping bar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: "var(--color-primary)",
          zIndex: 20,
          transformOrigin: "left",
          transform: scraping ? "scaleX(1)" : "scaleX(0)",
          opacity: scraping ? 1 : 0,
          transition: scraping
            ? "transform 2s cubic-bezier(0.4,0,0.6,1)"
            : "opacity 0.3s ease",
        }}
      />

      {/* pull indicator */}
      {pullDist > 0 && (
        <div
          style={{
            position: "absolute",
            top: 8,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 15,
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "var(--color-surface-dark-elevated)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 20,
            padding: "4px 10px",
            fontSize: 11,
            fontFamily: "var(--font-sans)",
            color: "var(--color-on-dark-soft)",
            opacity: pullProgress,
            transition: "opacity 0.1s",
          }}
        >
          <RefreshCw
            size={12}
            strokeWidth={1.5}
            style={{
              color: pullProgress >= 1 ? "var(--color-primary)" : "currentColor",
              transform: `rotate(${pullProgress * 360}deg)`,
            }}
          />
          {pullProgress >= 1 ? "Relâcher pour actualiser" : "Tirer pour actualiser"}
        </div>
      )}

      {/* control bar */}
      <div
        style={{
          padding: "6px 10px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          flexShrink: 0,
          transition: "transform 150ms ease-out, opacity 150ms ease-out",
          transform: barVisible ? "translateY(0)" : "translateY(-100%)",
          opacity: barVisible ? 1 : 0,
          position: "relative",
          zIndex: 10,
          background: "var(--color-surface-dark-soft)",
        }}
      >
        <ListCombobox
          allLists={allLists}
          selectedId={selectedListId}
          onSelect={setSelectedListId}
          onManage={() => setSettingsOpen(true)}
        />

        <div style={{ flex: 1 }} />

        <button
          onClick={() => {
            if (selectedListId !== null) loadTweets(selectedListId, 0, true);
          }}
          title="Actualiser"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--color-on-dark-soft)",
            padding: 4,
            display: "flex",
            alignItems: "center",
            opacity: 0.45,
            transition: "opacity var(--duration-fast)",
            borderRadius: 4,
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = "1")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.opacity = "0.45")}
        >
          <RefreshCw size={13} strokeWidth={1.5} style={{ color: scraping ? "var(--color-primary)" : "currentColor" }} />
        </button>

        <button
          onClick={() => setSettingsOpen(true)}
          title="Paramètres"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--color-on-dark-soft)",
            padding: 4,
            display: "flex",
            alignItems: "center",
            opacity: 0.45,
            transition: "opacity var(--duration-fast)",
            borderRadius: 4,
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = "1")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.opacity = "0.45")}
        >
          <Settings size={13} strokeWidth={1.5} />
        </button>
      </div>

      {/* tweet list */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => { dragStartY.current = null; setPullDist(0); }}
        style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          transform: pullDist > 0 ? `translateY(${pullDist * 0.4}px)` : "none",
          transition: pullDist === 0 ? "transform 0.2s ease" : "none",
        }}
      >
        {selectedListId === null ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              fontSize: 12,
              fontFamily: "var(--font-sans)",
              color: "var(--color-on-dark-soft)",
              opacity: 0.4,
              flexDirection: "column",
              gap: 8,
            }}
          >
            <span>Sélectionner une liste</span>
          </div>
        ) : tweetItems.length === 0 && !loadingMore ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              fontSize: 12,
              fontFamily: "var(--font-sans)",
              color: "var(--color-on-dark-soft)",
              opacity: 0.4,
            }}
          >
            Aucun tweet — actualiser pour scraper
          </div>
        ) : (
          <>
            {tweetItems.map((t) => (
              <TweetCard key={t.id} tweet={t} onFactCheck={handleFactCheck} />
            ))}

            {/* infinite scroll sentinel */}
            <div ref={sentinelRef} style={{ height: 1 }} />

            {loadingMore && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  padding: "12px 0",
                  opacity: 0.4,
                }}
              >
                <RefreshCw
                  size={14}
                  strokeWidth={1.5}
                  style={{
                    color: "var(--color-on-dark-soft)",
                    animation: "spin 1s linear infinite",
                  }}
                />
              </div>
            )}

            {!hasMore && tweetItems.length > 0 && (
              <div
                style={{
                  textAlign: "center",
                  padding: "10px 0",
                  fontSize: 11,
                  fontFamily: "var(--font-sans)",
                  color: "var(--color-on-dark-soft)",
                  opacity: 0.3,
                }}
              >
                · fin du fil ·
              </div>
            )}
          </>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
