import { useState } from "react";
import { X, ChevronRight, ChevronDown } from "lucide-react";
import { usePanelStore } from "../stores/panelStore";
import { GeneralSettings } from "./settings/GeneralSettings";
import { ChatSettings } from "./settings/ChatSettings";
import { XSettings } from "./settings/XSettings";
import { YouTubeSettings } from "./settings/YouTubeSettings";
import { YtdlpSettings } from "./settings/YtdlpSettings";

const SECTIONS = [
  { id: "general", label: "Général" },
  { id: "x", label: "X" },
  { id: "factcheck", label: "Chat IA" },
  { id: "ytdlp", label: "yt-dlp" },
  { id: "advanced", label: "Avancé" },
];

export function SettingsDrawer() {
  const { settingsOpen, setSettingsOpen } = usePanelStore();
  const [openSection, setOpenSection] = useState<string | null>(null);

  return (
    <>
      <div
        onClick={() => setSettingsOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.5)",
          zIndex: 100,
          opacity: settingsOpen ? 1 : 0,
          pointerEvents: settingsOpen ? "auto" : "none",
          transition: `opacity var(--duration-panel) var(--ease-panel)`,
        }}
      />
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          height: "100%",
          width: 480,
          background: "var(--color-surface-dark-elevated)",
          zIndex: 101,
          transform: settingsOpen ? "translateX(0)" : "translateX(100%)",
          transition: `transform var(--duration-panel) var(--ease-panel)`,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "16px 16px 12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 14,
              fontFamily: "var(--font-sans)",
              fontWeight: 500,
              color: "var(--color-on-dark)",
            }}
          >
            Paramètres
          </span>
          <button
            onClick={() => setSettingsOpen(false)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--color-on-dark-soft)",
              display: "flex",
              alignItems: "center",
              padding: 4,
            }}
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {SECTIONS.map(({ id, label }) => {
            const isOpen = openSection === id;
            return (
              <div key={id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <button
                  onClick={() => setOpenSection(isOpen ? null : id)}
                  style={{
                    width: "100%",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: "12px 16px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    fontFamily: "var(--font-sans)",
                    fontSize: 13,
                    fontWeight: 500,
                    color: "var(--color-on-dark)",
                    textAlign: "left",
                  }}
                >
                  {label}
                  <span style={{ transition: `transform var(--duration-fast)` }}>
                    {isOpen ? (
                      <ChevronDown size={14} strokeWidth={1.5} />
                    ) : (
                      <ChevronRight size={14} strokeWidth={1.5} />
                    )}
                  </span>
                </button>
                {isOpen && (
                  <div
                    style={{
                      padding: "8px 16px",
                      fontSize: 12,
                      color: "var(--color-on-dark-soft)",
                      fontFamily: "var(--font-sans)",
                    }}
                  >
                    {id === "x" ? (
                      <XSettings />
                    ) : id === "general" ? (
                      <GeneralSettings />
                    ) : id === "factcheck" ? (
                      <ChatSettings />
                    ) : id === "ytdlp" ? (
                      <YtdlpSettings />
                    ) : id === "advanced" ? (
                      <YouTubeSettings />
                    ) : (
                      "À configurer"
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
