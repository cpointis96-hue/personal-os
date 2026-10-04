import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePanelStore } from "../../stores/panelStore";

/**
 * YouTubeSettings — shown in the "Avancé" section of SettingsDrawer.
 *
 * Provides a button to clear the YouTube session (cookies, login, history)
 * for all open YouTube panels.
 */
export function YouTubeSettings() {
  const panels = usePanelStore((s) => s.panels);
  const [clearing, setClearing] = useState(false);
  const [done, setDone] = useState(false);

  const youtubePanelIds = panels
    .filter((p) => p.type === "youtube")
    .map((p) => p.id);

  const handleClearSession = async () => {
    setClearing(true);
    setDone(false);
    try {
      // Clear session for every open YouTube panel (or use a placeholder if none open)
      const targets = youtubePanelIds.length > 0 ? youtubePanelIds : ["__none__"];
      await Promise.allSettled(
        targets.map((panelId) => invoke("yt_clear_session", { panelId }))
      );
    } finally {
      setClearing(false);
      setDone(true);
      setTimeout(() => setDone(false), 2500);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        fontFamily: "var(--font-sans)",
      }}
    >
      <div
        style={{
          fontSize: 12,
          color: "var(--color-on-dark-soft)",
          lineHeight: 1.5,
        }}
      >
        Effacer les cookies, l'historique et la session YouTube (déconnexion incluse).
        {youtubePanelIds.length === 0 && (
          <span style={{ opacity: 0.6 }}>
            {" "}Aucun panneau YouTube ouvert — la session sera effacée au prochain lancement.
          </span>
        )}
      </div>

      <button
        onClick={handleClearSession}
        disabled={clearing}
        style={{
          alignSelf: "flex-start",
          background: clearing ? "rgba(255,255,255,0.05)" : "rgba(198,69,69,0.15)",
          border: "1px solid rgba(198,69,69,0.35)",
          borderRadius: 6,
          padding: "6px 12px",
          fontSize: 12,
          fontFamily: "var(--font-sans)",
          color: done ? "var(--color-success)" : "var(--color-error)",
          cursor: clearing ? "default" : "pointer",
          transition: "color 150ms ease-out, background 150ms ease-out",
        }}
        onMouseEnter={(e) => {
          if (!clearing)
            (e.currentTarget as HTMLElement).style.background = "rgba(198,69,69,0.25)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = clearing
            ? "rgba(255,255,255,0.05)"
            : "rgba(198,69,69,0.15)";
        }}
      >
        {clearing ? "Effacement…" : done ? "Session effacée" : "Effacer session YouTube"}
      </button>
    </div>
  );
}
