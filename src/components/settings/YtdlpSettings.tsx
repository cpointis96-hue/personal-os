import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, RefreshCw } from "lucide-react";
import { settings } from "../../lib/db/settings";

export function YtdlpSettings() {
  const [downloadDir, setDownloadDir] = useState("~/Downloads/personal-os");
  const [cookiesFile, setCookiesFile] = useState("");
  const [maxJobs, setMaxJobs] = useState(2);
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);

  useEffect(() => {
    settings.get<string>("ytdlp.download_dir").then((v) => {
      if (v) setDownloadDir(v);
    });
    settings.get<string>("ytdlp.cookies_file").then((v) => {
      if (v) setCookiesFile(v);
    });
    settings.get<number>("ytdlp.max_concurrent").then((v) => {
      if (v != null) {
        setMaxJobs(v);
        invoke("ytdlp_set_max_concurrent", { n: v }).catch(() => {});
      }
    });
    settings.get<boolean>("ytdlp.auto_update").then((v) => {
      if (v != null) setAutoUpdate(v);
    });
  }, []);

  const pickDownloadDir = async () => {
    const selected = await open({ directory: true, multiple: false }).catch(() => null);
    if (typeof selected === "string") {
      setDownloadDir(selected);
      await settings.set("ytdlp.download_dir", selected);
    }
  };

  const pickCookiesFile = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Cookies", extensions: ["txt"] }],
    }).catch(() => null);
    if (typeof selected === "string") {
      setCookiesFile(selected);
      await settings.set("ytdlp.cookies_file", selected);
    }
  };

  const clearCookiesFile = async () => {
    setCookiesFile("");
    await settings.set("ytdlp.cookies_file", "");
  };

  const onMaxJobsChange = async (n: number) => {
    setMaxJobs(n);
    await settings.set("ytdlp.max_concurrent", n);
    await invoke("ytdlp_set_max_concurrent", { n }).catch(() => {});
  };

  const onAutoUpdateChange = async (v: boolean) => {
    setAutoUpdate(v);
    await settings.set("ytdlp.auto_update", v);
  };

  const doUpdate = async () => {
    setUpdating(true);
    setUpdateMsg(null);
    try {
      const result = await invoke<string>("ytdlp_update");
      const lastLine = result
        .split("\n")
        .filter(Boolean)
        .pop() ?? "Mise à jour effectuée";
      setUpdateMsg(lastLine.slice(0, 80));
    } catch (e) {
      setUpdateMsg(`Erreur: ${e}`);
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Download dir */}
      <Field label="Dossier de téléchargement">
        <PathPicker value={downloadDir} onPick={pickDownloadDir} />
      </Field>

      {/* Cookies file */}
      <Field label="Fichier cookies (optionnel)">
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <PathPicker value={cookiesFile || "Aucun"} onPick={pickCookiesFile} />
          {cookiesFile && (
            <button
              onClick={clearCookiesFile}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--color-on-dark-soft)",
                fontSize: 10,
                padding: "2px 4px",
              }}
            >
              ×
            </button>
          )}
        </div>
      </Field>

      {/* Max concurrent */}
      <Field label={`Limite jobs parallèles — ${maxJobs}`}>
        <input
          type="range"
          min={1}
          max={8}
          value={maxJobs}
          onChange={(e) => onMaxJobsChange(Number(e.target.value))}
          style={{ width: 120, accentColor: "var(--color-primary)", cursor: "pointer" }}
        />
      </Field>

      {/* Auto-update */}
      <Field label="Mise à jour auto au démarrage">
        <Toggle value={autoUpdate} onChange={onAutoUpdateChange} />
      </Field>

      {/* Update button */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <button
          onClick={doUpdate}
          disabled={updating}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            background: "var(--color-surface-dark-soft)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "var(--radius-sm)",
            cursor: updating ? "default" : "pointer",
            color: "var(--color-on-dark)",
            fontSize: 12,
            fontFamily: "var(--font-sans)",
            opacity: updating ? 0.6 : 1,
            alignSelf: "flex-start",
          }}
        >
          <RefreshCw
            size={13}
            strokeWidth={1.5}
            style={{ animation: updating ? "spin 1s linear infinite" : "none" }}
          />
          {updating ? "Mise à jour…" : "Mettre à jour yt-dlp maintenant"}
        </button>
        {updateMsg && (
          <span
            style={{
              fontSize: 10,
              color: "var(--color-on-dark-soft)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {updateMsg}
          </span>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        fontSize: 12,
        color: "var(--color-on-dark)",
      }}
    >
      <span style={{ color: "var(--color-on-dark-soft)", flex: 1 }}>{label}</span>
      {children}
    </div>
  );
}

function PathPicker({ value, onPick }: { value: string; onPick: () => void }) {
  return (
    <button
      onClick={onPick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        background: "var(--color-surface-dark-soft)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "var(--radius-sm)",
        padding: "4px 8px",
        cursor: "pointer",
        color: "var(--color-on-dark-soft)",
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        maxWidth: 200,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      <FolderOpen size={12} strokeWidth={1.5} />
      {value.length > 26 ? "…" + value.slice(-24) : value}
    </button>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        width: 32,
        height: 16,
        borderRadius: 8,
        background: value ? "var(--color-primary)" : "rgba(255,255,255,0.12)",
        border: "none",
        cursor: "pointer",
        position: "relative",
        transition: "background var(--duration-fast)",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: value ? 18 : 2,
          width: 12,
          height: 12,
          borderRadius: "50%",
          background: "#fff",
          transition: "left var(--duration-fast)",
        }}
      />
    </button>
  );
}
