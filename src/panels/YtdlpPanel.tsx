import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  ChevronDown,
  ChevronUp,
  GripHorizontal,
  Download,
  History,
  Tv2,
  Check,
  X,
  Music2,
  Clapperboard,
  Captions,
} from "lucide-react";
import { query, run, runGetId } from "../lib/db";
import { settings } from "../lib/db/settings";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "dl" | "channel" | "history";
type Mode = "Audio" | "Vidéo" | "Subs";
type JobStatus = "queued" | "active" | "done" | "error";

interface Job {
  id: number;
  url: string;
  mode: string;
  status: JobStatus;
  progress: number;
  meta: string;
}

interface HistoryRow {
  id: number;
  url: string;
  title: string;
  mode: string;
  downloaded_at: number;
}
interface CountRow {
  c: number;
}

interface ChannelVideo {
  id: string;
  url: string;
  title: string;
  channel: string;
  duration?: number;
  upload_date?: string;
  checked: boolean;
}

// Presets: domain → auto-apply
const DOMAIN_PRESETS: Record<string, Partial<{ mode: Mode; audio_format: string; video_quality: string; video_codec: string }>> = {
  "music.youtube.com": { mode: "Audio", audio_format: "opus" },
  "youtube.com": { mode: "Vidéo", video_quality: "1080p", video_codec: "h264" },
  "youtu.be": { mode: "Vidéo", video_quality: "1080p", video_codec: "h264" },
  "instagram.com": { mode: "Vidéo", video_quality: "720p", video_codec: "h264" },
  "twitter.com": { mode: "Vidéo", video_quality: "720p", video_codec: "h264" },
  "x.com": { mode: "Vidéo", video_quality: "720p", video_codec: "h264" },
  "soundcloud.com": { mode: "Audio", audio_format: "mp3" },
  "bandcamp.com": { mode: "Audio", audio_format: "flac" },
};

const STATUS_LABEL: Record<JobStatus, string> = {
  queued: "en attente",
  active: "téléchargement",
  done: "terminé",
  error: "erreur",
};

const STATUS_COLOR: Record<JobStatus, string> = {
  queued: "var(--color-on-dark-soft)",
  active: "var(--color-primary)",
  done: "#4caf72",
  error: "#e05a5a",
};

function isChannelUrl(url: string): boolean {
  try {
    const p = new URL(url);
    if (!p.hostname.includes("youtube.com") && !p.hostname.includes("youtu.be")) return false;
    if (/^\/@[^/?#]+/.test(p.pathname)) return true;
    if (/^\/(c|user|channel)\/[^/?#]+/.test(p.pathname)) return true;
    if (p.pathname.includes("/playlist")) return true;
    if (p.searchParams.has("list") && !p.searchParams.has("v")) return true;
  } catch {}
  return false;
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function fmtDuration(s?: number): string {
  if (!s) return "";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function fmtDate(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  return `${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1).toString().padStart(2, "0")} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}
function fmtClock(tsMs: number): string {
  const d = new Date(tsMs);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function shortUrl(u: string): string {
  try {
    const p = new URL(u);
    return (p.hostname + p.pathname).replace(/^www\./, "").slice(0, 50);
  } catch {
    return u.slice(0, 50);
  }
}

function parseMeta(meta?: string): { start?: string | null; end?: string | null; title?: string | null } {
  if (!meta) return {};
  try {
    return JSON.parse(meta) as { start?: string | null; end?: string | null; title?: string | null };
  } catch {
    return {};
  }
}

function compactRange(start?: string | null, end?: string | null): string {
  if (!start && !end) return "";
  const s = start || "00:00";
  const e = end || "";
  return e ? `${s}-${e}` : s;
}

function makeHistoryUrl(url: string): string {
  const ts = Date.now();
  const sep = url.includes("#") ? "&" : "#";
  return `${url}${sep}__dl=${ts}`;
}

function stripHistoryUrl(url: string): string {
  return url.replace(/([#&])__dl=\d+$/, "");
}

// ── Main component ────────────────────────────────────────────────────────────

export function YtdlpPanel() {
  const [tab, setTab] = useState<Tab>("dl");

  // DL tab state
  const [urls, setUrls] = useState("");
  const [mode, setMode] = useState<Mode>("Audio");
  const [advOpen, setAdvOpen] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logOpen, setLogOpen] = useState(true);
  const [logHeight, setLogHeight] = useState(120);
  const [downloadSummary, setDownloadSummary] = useState("Prêt");
  const [, setBatchProgress] = useState<{ mode: Mode; total: number; done: number } | null>(null);

  // Audio opts
  const [audioFormat, setAudioFormat] = useState("mp3");
  // Video opts
  const [videoQuality, setVideoQuality] = useState("1080p");
  const [videoFormat, setVideoFormat] = useState("mp4");
  const [videoCodec, setVideoCodec] = useState("h264");
  const [embedSubs, setEmbedSubs] = useState(false);
  const [embedThumb, setEmbedThumb] = useState(true);
  // Subs opts
  const [subLang, setSubLang] = useState("fr");
  const [subFormat, setSubFormat] = useState("txt");
  // Time trim
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  // Advanced flags
  const [sponsorblock, setSponsorblock] = useState(false);
  const [splitChapters, setSplitChapters] = useState(false);
  const [playlist, setPlaylist] = useState(false);

  // Channel tab state
  const [channelUrl, setChannelUrl] = useState("");
  const [channelVideos, setChannelVideos] = useState<ChannelVideo[]>([]);
  const [channelLoading, setChannelLoading] = useState(false);
  const [channelName, setChannelName] = useState("");

  // History tab state
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [histSearch, setHistSearch] = useState("");

  // Version
  const [version, setVersion] = useState("");

  const logViewportRef = useRef<HTMLDivElement>(null);
  const logStickToBottomRef = useRef(true);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  // Stable refs — used inside event listeners to avoid stale closure / listener re-registration
  const channelNameRef = useRef("");
  useEffect(() => { channelNameRef.current = channelName; }, [channelName]);

  // ── Init ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    loadJobs();
    invoke<string>("ytdlp_version").then(setVersion).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab === "history") loadHistory();
  }, [tab, histSearch]);

  useEffect(() => {
    if (logOpen && logStickToBottomRef.current && logViewportRef.current) {
      const el = logViewportRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [logLines, logOpen]);

  // ── Events ────────────────────────────────────────────────────────────────

  // Stable: download events — never re-registers, safe for progress/complete/error/log
  useEffect(() => {
    const uns: Array<() => void> = [];

    listen<{ id: number; progress: number }>("ytdlp://progress", (e) => {
      const { id, progress } = e.payload;
      setJobs((prev) =>
        prev.map((j) => (j.id === id ? { ...j, progress, status: "active" } : j))
      );
      run("UPDATE jobs SET progress=?, status='active', updated_at=? WHERE id=?", [
        progress, Date.now() / 1000, id,
      ]).catch(() => {});
    }).then((u) => uns.push(u));

    listen<{ id: number; title: string }>("ytdlp://complete", async (e) => {
      const { id, title } = e.payload;
      setJobs((prev) => prev.filter((j) => j.id !== id));
      await run("UPDATE jobs SET progress=1, status='done', updated_at=? WHERE id=?", [
        Date.now() / 1000, id,
      ]).catch(() => {});
      const metaRows = await query<{ meta: string }>("SELECT meta FROM jobs WHERE id=?", [id]).catch(
        () => [] as { meta: string }[]
      );
      if (metaRows.length > 0) {
        const parsed = parseMeta(metaRows[0].meta);
        await run("UPDATE jobs SET meta=? WHERE id=?", [
          JSON.stringify({ ...parsed, title: title || parsed.title || null }),
          id,
        ]).catch(() => {});
      }
      const rows = await query<Job>("SELECT url, mode FROM jobs WHERE id=?", [id]).catch(
        () => [] as Job[]
      );
      if (rows.length > 0) {
        const m = rows[0].mode as Mode;
        setBatchProgress((prev) => {
          if (!prev || prev.mode !== m) {
            setDownloadSummary(`Dernier DL · ${m} · ${fmtClock(Date.now())}`);
            return prev;
          }
          const done = Math.min(prev.total, prev.done + 1);
          if (done >= prev.total) {
            setDownloadSummary(
              `Dernier DL · ${prev.total > 1 ? `${prev.total}× ` : ""}${m} · ${fmtClock(Date.now())}`
            );
            return null;
          }
          return { ...prev, done };
        });
        await run(
          "INSERT INTO history(url, title, mode, downloaded_at) VALUES (?,?,?,?)",
          [makeHistoryUrl(rows[0].url), title || rows[0].url, rows[0].mode, Date.now() / 1000]
        ).catch(() => {});
      }
    }).then((u) => uns.push(u));

    listen<{ id: number; message: string }>("ytdlp://error", (e) => {
      const { id } = e.payload;
      setJobs((prev) =>
        prev.map((j) => (j.id === id ? { ...j, status: "error" } : j))
      );
      run("UPDATE jobs SET status='error', updated_at=? WHERE id=?", [
        Date.now() / 1000, id,
      ]).catch(() => {});
    }).then((u) => uns.push(u));

    listen<{ id: number; line: string }>("ytdlp://log", (e) => {
      setLogLines((prev) => [...prev.slice(-300), e.payload.line]);
    }).then((u) => uns.push(u));

    return () => uns.forEach((u) => u());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Stable: channel events — uses channelNameRef to avoid stale closure / re-registration
  useEffect(() => {
    const uns: Array<() => void> = [];

    listen<{ id: string; url: string; title: string; channel: string; duration?: number }>(
      "ytdlp://channel-entry",
      (e) => {
        const entry = e.payload;
        if (!channelNameRef.current && entry.channel) {
          setChannelName(entry.channel);
        }
        // Deduplicate by id — guards against React Strict Mode double-firing
        setChannelVideos((prev) =>
          prev.some((v) => v.id === entry.id) ? prev : [...prev, { ...entry, checked: false }]
        );
      }
    ).then((u) => uns.push(u));

    listen("ytdlp://channel-done", () => {
      setChannelLoading(false);
    }).then((u) => uns.push(u));

    return () => uns.forEach((u) => u());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ──────────────────────────────────────────────────────────────

  const loadJobs = useCallback(async () => {
    const rows = await query<Job>(
      "SELECT * FROM jobs WHERE status IN ('queued','active','error') ORDER BY created_at DESC LIMIT 60"
    ).catch(() => []);
    setJobs(rows);
  }, []);

  const loadHistory = useCallback(async () => {
    const q = histSearch.trim();
    const rows = q
      ? await query<HistoryRow>(
          "SELECT * FROM history WHERE title LIKE ? OR url LIKE ? ORDER BY downloaded_at DESC LIMIT 40",
          [`%${q}%`, `%${q}%`]
        ).catch(() => [])
      : await query<HistoryRow>(
          "SELECT * FROM history ORDER BY downloaded_at DESC LIMIT 30"
        ).catch(() => []);
    setHistory(rows);
  }, [histSearch]);

  const applyPreset = useCallback(
    (url: string) => {
      const domain = getDomain(url);
      const preset = DOMAIN_PRESETS[domain];
      if (!preset) return;
      if (preset.mode) setMode(preset.mode);
      if (preset.audio_format) setAudioFormat(preset.audio_format);
      if (preset.video_quality) setVideoQuality(preset.video_quality);
      if (preset.video_codec) setVideoCodec(preset.video_codec);
    },
    []
  );

  const onUrlChange = useCallback(
    (value: string) => {
      setUrls(value);
      const firstUrl = value.trim().split("\n")[0].trim();
      if (firstUrl) applyPreset(firstUrl);
      // Auto-switch to channel tab if channel URL detected
      if (firstUrl && isChannelUrl(firstUrl)) {
        setChannelUrl(firstUrl);
      }
    },
    [applyPreset]
  );

  const buildOpts = useCallback(
    async (_url: string, channelFolder?: string, overwriteIdx = 0) => {
      const dlDir =
        (await settings.get<string>("ytdlp.download_dir")) ?? "~/Downloads/personal-os";
      const cookiesFile = (await settings.get<string>("ytdlp.cookies_file")) ?? "";
      return {
        mode,
        download_dir: dlDir,
        cookies_file: cookiesFile,
        audio_format: audioFormat,
        video_quality: videoQuality,
        video_format: videoFormat,
        video_codec: videoCodec,
        sub_lang: subLang,
        sub_format: subFormat,
        embed_subs: embedSubs,
        embed_thumb: embedThumb,
        sponsorblock,
        split_chapters: splitChapters,
        playlist,
        start: startTime || undefined,
        end: endTime || undefined,
        channel_folder: channelFolder ?? undefined,
        overwrite_idx: overwriteIdx > 0 ? overwriteIdx : undefined,
      };
    },
    [mode, audioFormat, videoQuality, videoFormat, videoCodec, subLang, subFormat,
     embedSubs, embedThumb, sponsorblock, splitChapters, playlist, startTime, endTime]
  );

  const enqueueUrl = useCallback(
    async (url: string, channelFolder?: string) => {
      try {
        const metaObj = { start: startTime || null, end: endTime || null };
        const metaStr = JSON.stringify(metaObj);
        const countRows = await query<CountRow>(
          "SELECT COUNT(*) as c FROM jobs WHERE url=? AND mode=? AND meta=?",
          [url, mode, metaStr]
        ).catch(() => [{ c: 0 }]);
        const overwriteIdx = Number(countRows[0]?.c ?? 0);
        const opts = await buildOpts(url, channelFolder, overwriteIdx);
        const now = Date.now() / 1000;
        const jobId = await runGetId(
          "INSERT INTO jobs(url, mode, preset, status, progress, meta, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
          [url, mode, "{}", "queued", 0, metaStr, now, now]
        );
        setJobs((prev) => [
          { id: jobId, url, mode, status: "queued", progress: 0, meta: metaStr },
          ...prev,
        ]);
        await invoke("ytdlp_enqueue", { jobId, url, opts }).catch((e: unknown) => console.error("[ytdlp] ytdlp_enqueue failed:", e));
        return jobId;
      } catch (e) {
        console.error("enqueueUrl failed:", e);
        throw e;
      }
    },
    [buildOpts, mode, startTime, endTime]
  );

  const addJobs = useCallback(async () => {
    const lines = urls
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("http"));
    if (lines.length === 0) return;
    setBatchProgress({ mode, total: lines.length, done: 0 });
    setDownloadSummary(`En cours · ${mode} · 0/${lines.length} URL${lines.length > 1 ? "s" : ""}`);
    for (const u of lines) await enqueueUrl(u).catch(console.error);
  }, [urls, enqueueUrl]);

  const fetchChannel = useCallback(async () => {
    const u = channelUrl.trim();
    if (!u) return;
    setChannelVideos([]);
    setChannelName("");
    setChannelLoading(true);
    invoke("ytdlp_fetch_channel", { url: u }).catch(() => setChannelLoading(false));
  }, [channelUrl]);

  const downloadChannelSelection = useCallback(async () => {
    const selected = channelVideos.filter((v) => v.checked);
    if (!selected.length) return;
    const folder = channelName
      ? channelName.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 100)
      : "";
    setBatchProgress({ mode, total: selected.length, done: 0 });
    setDownloadSummary(`En cours · ${mode} · 0/${selected.length} URL${selected.length > 1 ? "s" : ""}`);
    for (const v of selected) {
      await enqueueUrl(v.url, folder).catch(console.error);
    }
    setTab("dl");
    setChannelVideos((prev) => prev.map((v) => ({ ...v, checked: false })));
  }, [channelVideos, channelName, enqueueUrl]);

  const selectAll = useCallback((val: boolean) => {
    setChannelVideos((prev) => prev.map((v) => ({ ...v, checked: val })));
  }, []);

  const onLogDragStart = useCallback((e: React.MouseEvent) => {
    dragRef.current = { startY: e.clientY, startH: logHeight };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startY - ev.clientY;
      setLogHeight(Math.max(40, Math.min(480, dragRef.current.startH + delta)));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [logHeight]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        fontFamily: "var(--font-sans)",
        background: "var(--color-surface-dark-soft)",
      }}
    >
      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          gap: 0,
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          flexShrink: 0,
        }}
      >
        {([
          { id: "dl", Icon: Download, label: "DL" },
          { id: "channel", Icon: Tv2, label: "Chaîne" },
          { id: "history", Icon: History, label: "Historique" },
        ] as { id: Tab; Icon: React.ElementType; label: string }[]).map(({ id, Icon, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            aria-label={label}
            title={label}
            style={{
              flex: 1,
              padding: "7px 0",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "none",
              border: "none",
              borderBottom: tab === id ? "2px solid var(--color-primary)" : "2px solid transparent",
              cursor: "pointer",
              fontSize: 11,
              color: tab === id ? "var(--color-primary)" : "var(--color-on-dark-soft)",
              transition: "color var(--duration-fast)",
              marginBottom: -1,
            }}
          >
            <Icon size={12} strokeWidth={1.5} />
          </button>
        ))}
      </div>

      {/* ── DL Tab ─────────────────────────────────────────────────────── */}
      {tab === "dl" && (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
          {/* URL input */}
          <div style={{ padding: "8px 10px 6px", borderBottom: "1px solid rgba(255,255,255,0.05)", flexShrink: 0 }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
              <textarea
                value={urls}
                onChange={(e) => onUrlChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    addJobs();
                  }
                }}
                placeholder=""
                rows={1}
                wrap="off"
                style={{
                  flex: 1,
                  background: "var(--color-surface-dark-elevated)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "var(--radius-sm)",
                  padding: "5px 8px",
                  fontSize: 9,
                  color: "var(--color-on-dark)",
                  outline: "none",
                  resize: "none",
                  fontFamily: "var(--font-mono)",
                  lineHeight: 1.45,
                  overflowX: "auto",
                  overflowY: "hidden",
                  whiteSpace: "nowrap",
                }}
              />
              <button
                onClick={addJobs}
                style={{
                  padding: "0 10px",
                  background: "var(--color-primary)",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 12,
                  color: "#fff",
                  flexShrink: 0,
                  alignSelf: "stretch",
                }}
              >
                <Download size={13} strokeWidth={1.5} />
                Télécharger
              </button>
            </div>
            <div style={{ marginTop: 2, fontSize: 10, color: "var(--color-on-dark-soft)", opacity: 0.85, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {downloadSummary}
            </div>
            {/* Detect channel hint */}
            {urls.trim() && isChannelUrl(urls.trim().split("\n")[0]) && (
              <button
                onClick={() => {
                  setChannelUrl(urls.trim().split("\n")[0]);
                  setTab("channel");
                }}
                style={{
                  fontSize: 10,
                  color: "var(--color-primary)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                }}
              >
                <Tv2 size={10} strokeWidth={1.5} />
                URL de chaîne détectée — ouvrir le navigateur chaîne
              </button>
            )}
          </div>

          {/* Mode + options */}
          <div style={{ padding: "6px 10px", borderBottom: "1px solid rgba(255,255,255,0.05)", flexShrink: 0 }}>
            {/* Segmented mode */}
            <div
              style={{
                display: "flex",
                gap: 2,
                background: "var(--color-surface-dark-elevated)",
                borderRadius: "var(--radius-sm)",
                padding: 2,
                marginBottom: 6,
              }}
            >
              {([
                { id: "Audio", label: "Audio", Icon: Music2 },
                { id: "Vidéo", label: "Vidéo", Icon: Clapperboard },
                { id: "Subs", label: "Subs", Icon: Captions },
              ] as { id: Mode; label: string; Icon: React.ElementType }[]).map(({ id, label, Icon }) => (
                <button
                  key={id}
                  onClick={() => setMode(id)}
                  aria-label={label}
                  title={label}
                  style={{
                    flex: 1,
                    padding: "3px 0",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    border: "none",
                    borderRadius: "calc(var(--radius-sm) - 2px)",
                    cursor: "pointer",
                    background: mode === id ? "var(--color-primary)" : "transparent",
                    color: mode === id ? "#fff" : "var(--color-on-dark-soft)",
                    transition: "background var(--duration-fast), color var(--duration-fast)",
                  }}
                >
                  <Icon size={12} strokeWidth={1.7} />
                </button>
              ))}
            </div>

            {/* Mode-specific opts inline */}
            <div style={{ display: "flex", gap: 9, marginBottom: 9, flexWrap: "wrap" }}>
              {mode === "Audio" && (
                <MiniSelect
                  value={audioFormat}
                  onChange={setAudioFormat}
                  options={["mp3", "m4a", "opus", "flac", "wav", "aac"]}
                />
              )}
              {mode === "Vidéo" && (
                <>
                  <MiniSelect
                    value={videoQuality}
                    onChange={setVideoQuality}
                    options={["Best", "2160p", "1440p", "1080p", "720p", "480p", "360p"]}
                  />
                  <MiniSelect
                    value={videoFormat}
                    onChange={setVideoFormat}
                    options={["mp4", "mkv", "webm"]}
                  />
                  <MiniSelect
                    value={videoCodec}
                    onChange={setVideoCodec}
                    options={["h264", "av1", "vp9", "any"]}
                  />
                </>
              )}
              {mode === "Subs" && (
                <>
                  <MiniSelect
                    value={subFormat}
                    onChange={setSubFormat}
                    options={["txt", "srt"]}
                  />
                  <MiniSelect
                    value={subLang}
                    onChange={setSubLang}
                    options={["fr", "en", "es", "de", "it", "pt", "ja", "ko", "zh", "ar", "ru"]}
                  />
                </>
              )}
            </div>

            {/* Time trim */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <input
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                placeholder="00:00"
                style={timeInputStyle}
              />
              <span style={{ color: "var(--color-on-dark-soft)", fontSize: 11 }}>—</span>
              <input
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                placeholder="05:30"
                style={timeInputStyle}
              />
              {(startTime || endTime) && (
                <button
                  onClick={() => { setStartTime(""); setEndTime(""); }}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-on-dark-soft)", fontSize: 11, padding: "0 2px" }}
                >
                  <X size={11} strokeWidth={1.5} />
                </button>
              )}
            </div>

            {/* Advanced toggle */}
            <button
              onClick={() => setAdvOpen((v) => !v)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 3,
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--color-on-dark-soft)",
                fontSize: 10,
                padding: 0,
              }}
            >
              {advOpen ? <ChevronUp size={11} strokeWidth={1.5} /> : <ChevronDown size={11} strokeWidth={1.5} />}
              Avancé
            </button>

            {advOpen && (
              <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: "6px 12px" }}>
                <ToggleChip label="Miniature" value={embedThumb} onChange={setEmbedThumb} />
                {mode === "Vidéo" && (
                  <ToggleChip label="Subs embarqués" value={embedSubs} onChange={setEmbedSubs} />
                )}
                <ToggleChip label="SponsorBlock" value={sponsorblock} onChange={setSponsorblock} />
                <ToggleChip label="Par chapitres" value={splitChapters} onChange={setSplitChapters} />
                <ToggleChip label="Playlist" value={playlist} onChange={setPlaylist} />
              </div>
            )}
          </div>

          {/* Job list */}
          <div style={{ flex: 1, overflowY: "auto", padding: "2px 0" }}>
            {jobs.length === 0 && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 80, fontSize: 11, color: "var(--color-on-dark-soft)", opacity: 0.4 }}>
                Aucun téléchargement
              </div>
            )}
            {jobs.filter((j) => j.status !== "done").map((job) => (
              <div
                key={job.id}
                style={{ padding: "5px 10px", borderBottom: "1px solid rgba(255,255,255,0.03)" }}
              >
                {(() => {
                  const parsed = parseMeta(job.meta);
                  const label = parsed.title || shortUrl(job.url);
                  const range = compactRange(parsed.start, parsed.end);
                  const modeIcon = job.mode === "Audio"
                    ? <Music2 size={11} strokeWidth={1.8} />
                    : job.mode === "Vidéo"
                    ? <Clapperboard size={11} strokeWidth={1.8} />
                    : <Captions size={11} strokeWidth={1.8} />;
                  return (
                    <>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
                        <span style={{ fontSize: 11, color: "var(--color-on-dark)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "80%", display: "flex", alignItems: "center", gap: 6 }}>
                          {modeIcon}
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {label}{range ? ` ${range}` : ""}
                          </span>
                        </span>
                        <span style={{ fontSize: 10, color: STATUS_COLOR[job.status], flexShrink: 0 }}>
                    {job.status === "active" ? `${Math.round(job.progress * 100)}%` : STATUS_LABEL[job.status]}
                  </span>
                </div>
                <div style={{ height: 2, background: "rgba(255,255,255,0.06)", borderRadius: 1, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.round(job.progress * 100)}%`, background: job.status === "error" ? "#e05a5a" : "var(--color-primary)", transition: "width 0.3s ease" }} />
                </div>
                  </>
                  );
                })()}
              </div>
            ))}
          </div>

          {/* Version */}
          {version && (
            <div style={{ padding: "2px 10px", fontSize: 9, color: "var(--color-on-dark-soft)", opacity: 0.4, flexShrink: 0 }}>
              yt-dlp {version}
            </div>
          )}

          {/* Log */}
          <div style={{ flexShrink: 0, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
            <div
              onMouseDown={onLogDragStart}
              style={{ height: 14, display: "flex", alignItems: "center", justifyContent: "center", cursor: "ns-resize", color: "var(--color-on-dark-soft)", opacity: 0.35 }}
            >
              <GripHorizontal size={11} strokeWidth={1.5} />
            </div>
            <button
              onClick={() => setLogOpen((v) => !v)}
              style={{ width: "100%", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, padding: "1px 10px 4px", fontSize: 10, color: "var(--color-on-dark-soft)", opacity: 0.5 }}
            >
              {logOpen ? <ChevronDown size={10} strokeWidth={1.5} /> : <ChevronUp size={10} strokeWidth={1.5} />}
              Log
            </button>
            {logOpen && (
              <div
                ref={logViewportRef}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
                  logStickToBottomRef.current = distanceToBottom < 24;
                }}
                style={{ height: logHeight, overflowY: "auto", padding: "4px 10px", background: "var(--color-surface-dark-elevated)", fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--color-on-dark-soft)", lineHeight: 1.6 }}
              >
                {logLines.map((line, i) => (
                  <div key={i} style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{line}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Channel Tab ────────────────────────────────────────────────── */}
      {tab === "channel" && (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
          {/* URL input + fetch */}
          <div style={{ padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.05)", flexShrink: 0 }}>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                value={channelUrl}
                onChange={(e) => setChannelUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && fetchChannel()}
                placeholder=""
                style={{
                  flex: 1,
                  height: 28,
                  background: "var(--color-surface-dark-elevated)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "var(--radius-sm)",
                  padding: "0 8px",
                  fontSize: 11,
                  color: "var(--color-on-dark)",
                  outline: "none",
                  fontFamily: "var(--font-mono)",
                }}
              />
              <button
                onClick={fetchChannel}
                disabled={channelLoading}
                style={{
                  height: 28,
                  padding: "0 10px",
                  background: channelLoading ? "rgba(204,120,92,0.4)" : "var(--color-primary)",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  cursor: channelLoading ? "default" : "pointer",
                  fontSize: 11,
                  color: "#fff",
                  flexShrink: 0,
                }}
              >
                {channelLoading ? "Chargement…" : "Charger"}
              </button>
            </div>
          </div>

          {/* Controls */}
          {channelVideos.length > 0 && (
            <div style={{ padding: "4px 10px", display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid rgba(255,255,255,0.04)", flexShrink: 0 }}>
              <button onClick={() => selectAll(true)} style={ghostBtn}>Tout</button>
              <button onClick={() => selectAll(false)} style={ghostBtn}>Aucun</button>
              <span style={{ fontSize: 10, color: "var(--color-on-dark-soft)", flex: 1 }}>
                {channelName && <span style={{ color: "var(--color-primary)" }}>{channelName.slice(0, 24)} · </span>}
                {channelVideos.length} vidéo{channelVideos.length > 1 ? "s" : ""}
                {" · "}{channelVideos.filter((v) => v.checked).length} sélectionnée{channelVideos.filter((v) => v.checked).length > 1 ? "s" : ""}
              </span>
            </div>
          )}

          {/* Video list */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {channelVideos.length === 0 && !channelLoading && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 80, fontSize: 11, color: "var(--color-on-dark-soft)", opacity: 0.4 }}>
                Entrer une URL de chaîne ou playlist
              </div>
            )}
            {channelVideos.map((v, i) => (
              <div
                key={v.id}
                onClick={() =>
                  setChannelVideos((prev) =>
                    prev.map((item, idx) => idx === i ? { ...item, checked: !item.checked } : item)
                  )
                }
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "5px 10px",
                  borderBottom: "1px solid rgba(255,255,255,0.03)",
                  cursor: "pointer",
                  background: v.checked ? "rgba(204,120,92,0.06)" : "transparent",
                }}
              >
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 3,
                    border: `1.5px solid ${v.checked ? "var(--color-primary)" : "rgba(255,255,255,0.2)"}`,
                    background: v.checked ? "var(--color-primary)" : "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    transition: "background var(--duration-fast)",
                  }}
                >
                  {v.checked && <Check size={9} strokeWidth={2.5} color="#fff" />}
                </div>
                <span style={{ fontSize: 10, color: "var(--color-on-dark-soft)", opacity: 0.5, width: 20, textAlign: "right", flexShrink: 0 }}>
                  {i + 1}
                </span>
                <span style={{ fontSize: 11, color: "var(--color-on-dark)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {v.title || v.id}
                </span>
                {v.duration && (
                  <span style={{ fontSize: 10, color: "var(--color-on-dark-soft)", flexShrink: 0 }}>
                    {fmtDuration(v.duration)}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Download button */}
          {channelVideos.some((v) => v.checked) && (
            <div style={{ padding: "8px 10px", borderTop: "1px solid rgba(255,255,255,0.05)", flexShrink: 0 }}>
              <button
                onClick={downloadChannelSelection}
                style={{
                  width: "100%",
                  height: 34,
                  background: "var(--color-primary)",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                  color: "#fff",
                  fontSize: 12,
                  fontFamily: "var(--font-sans)",
                }}
              >
                Télécharger {channelVideos.filter((v) => v.checked).length} vidéo{channelVideos.filter((v) => v.checked).length > 1 ? "s" : ""} sélectionnée{channelVideos.filter((v) => v.checked).length > 1 ? "s" : ""}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── History Tab ────────────────────────────────────────────────── */}
      {tab === "history" && (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
          <div style={{ padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.05)", flexShrink: 0 }}>
            <input
              value={histSearch}
              onChange={(e) => setHistSearch(e.target.value)}
              placeholder="Rechercher…"
              style={{
                width: "100%",
                height: 28,
                background: "var(--color-surface-dark-elevated)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: "var(--radius-sm)",
                padding: "0 8px",
                fontSize: 11,
                color: "var(--color-on-dark)",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {history.length === 0 && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 80, fontSize: 11, color: "var(--color-on-dark-soft)", opacity: 0.4 }}>
                Aucun historique
              </div>
            )}
            {history.map((h) => (
              <div
                key={h.id}
                style={{ padding: "7px 10px", borderBottom: "1px solid rgba(255,255,255,0.03)" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                  <span style={{ fontSize: 10, color: "var(--color-primary)" }}>
                    {h.mode} · {fmtDate(h.downloaded_at)}
                  </span>
                  <button
                    onClick={() => {
                      setUrls(stripHistoryUrl(h.url));
                      setTab("dl");
                    }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-on-dark-soft)", fontSize: 10, padding: 0 }}
                    title="Retélécharger"
                  >
                    ↩
                  </button>
                </div>
                <div style={{ fontSize: 11, color: "var(--color-on-dark)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {h.title || shortUrl(h.url)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

const timeInputStyle: React.CSSProperties = {
  flex: 1,
  height: 26,
  background: "var(--color-surface-dark-elevated)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "var(--radius-sm)",
  padding: "0 8px",
  fontSize: 11,
  color: "var(--color-on-dark)",
  outline: "none",
  fontFamily: "var(--font-mono)",
};

const ghostBtn: React.CSSProperties = {
  background: "none",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  color: "var(--color-on-dark-soft)",
  fontSize: 10,
  padding: "2px 8px",
};

function MiniSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          height: 26,
          minWidth: 66,
          background: "var(--color-surface-dark-elevated)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "var(--radius-sm)",
          color: "var(--color-on-dark)",
          fontSize: 11,
          padding: "0 8px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span>{value}</span>
        <ChevronDown size={11} strokeWidth={1.6} style={{ opacity: 0.75 }} />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: 28,
            left: 0,
            zIndex: 20,
            minWidth: "100%",
            background: "var(--color-surface-dark-elevated)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "var(--radius-sm)",
            boxShadow: "0 8px 20px rgba(0,0,0,0.35)",
            overflow: "hidden",
          }}
        >
          {options.map((o) => (
            <button
              key={o}
              onClick={() => {
                onChange(o);
                setOpen(false);
              }}
              style={{
                width: "100%",
                height: 26,
                textAlign: "left",
                padding: "0 8px",
                border: "none",
                cursor: "pointer",
                background: o === value ? "rgba(204,120,92,0.2)" : "transparent",
                color: o === value ? "var(--color-primary)" : "var(--color-on-dark)",
                fontSize: 11,
              }}
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ToggleChip({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        background: value ? "rgba(204,120,92,0.18)" : "var(--color-surface-dark-elevated)",
        border: `1px solid ${value ? "var(--color-primary)" : "rgba(255,255,255,0.08)"}`,
        borderRadius: 12,
        cursor: "pointer",
        color: value ? "var(--color-primary)" : "var(--color-on-dark-soft)",
        fontSize: 10,
        padding: "2px 8px",
        transition: "all var(--duration-fast)",
      }}
    >
      {label}
    </button>
  );
}
