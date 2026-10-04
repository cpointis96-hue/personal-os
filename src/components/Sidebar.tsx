import {
  LayoutGrid,
  Plus,
  Settings,
  Twitter,
  Youtube,
  TerminalSquare,
  Download,
  MessageSquare,
  Globe,
} from "lucide-react";
import type { ElementType } from "react";
import { usePanelStore, type Panel } from "../stores/panelStore";

type PanelType = Panel["type"];

function getPanelIcon(type: PanelType): ElementType {
  switch (type) {
    case "x": return Twitter;
    case "youtube": return Youtube;
    case "terminal": return TerminalSquare;
    case "ytdlp": return Download;
    case "chat": return MessageSquare;
    case "browser": return Globe;
    default: return LayoutGrid;
  }
}

function getPanelLabel(type: PanelType): string {
  switch (type) {
    case "x":
      return "X";
    case "youtube":
      return "Youtube";
    case "terminal":
      return "Terminal";
    case "ytdlp":
      return "Yt-dlpGUI";
    case "chat":
      return "Chat";
    case "browser":
      return "Browser";
    default:
      return "Nouveau";
  }
}

export function Sidebar() {
  const {
    addPanel,
    setSettingsOpen,
    panels,
    focusedPanelId,
    focusPanel,
  } = usePanelStore();
  const width = 48;
  const shellWidth = 48;
  const showLabels = false;

  return (
    <div
      style={{
        position: "relative",
        width: shellWidth,
        minWidth: shellWidth,
        height: "100%",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          width,
          transition: `width var(--duration-panel) var(--ease-panel)`,
          background: "var(--color-surface-dark)",
          borderRight: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          zIndex: 20,
          boxShadow: "0 0 0 1px rgba(0,0,0,0.12)",
        }}
      >
        <button
          title="Personal OS"
          style={{
            background: "none",
            border: "none",
            cursor: "default",
            padding: "16px 0",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--color-on-dark-soft)",
            width: "100%",
            flexShrink: 0,
          }}
        >
          <LayoutGrid size={16} strokeWidth={1.5} />
          {showLabels && (
            <span
              style={{
                marginLeft: 8,
                fontSize: 13,
                fontFamily: "var(--font-sans)",
                color: "var(--color-on-dark)",
                fontWeight: 500,
                whiteSpace: "nowrap",
              }}
            >
              Personal OS
            </span>
          )}
        </button>

        <button
          onClick={addPanel}
          title="Nouveau panneau"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "8px 0",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--color-on-dark-soft)",
            width: "100%",
            flexShrink: 0,
            transition: "color var(--duration-fast)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = "var(--color-on-dark)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = "var(--color-on-dark-soft)";
          }}
        >
          <Plus size={16} strokeWidth={1.5} />
          {showLabels && (
            <span
              style={{
                marginLeft: 8,
                fontSize: 13,
                fontFamily: "var(--font-sans)",
                whiteSpace: "nowrap",
              }}
            >
              Nouveau panneau
            </span>
          )}
        </button>

        <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
          {panels.map((panel) => {
            const Icon = getPanelIcon(panel.type);
            const isActive = focusedPanelId === panel.id;
            const label = panel.type ? getPanelLabel(panel.type) : panel.title;
            return (
              <button
                key={panel.id}
                onClick={() => focusPanel(panel.id)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "6px 0",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: isActive ? "var(--color-primary)" : "var(--color-on-dark-soft)",
                  width: "100%",
                  transition: "color var(--duration-fast)",
                }}
              >
                <Icon size={16} strokeWidth={1.5} />
                {showLabels && (
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 13,
                      fontFamily: "var(--font-sans)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      maxWidth: 130,
                    }}
                  >
                    {label}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => setSettingsOpen(true)}
          title="Paramètres"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "16px 0",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--color-on-dark-soft)",
            width: "100%",
            flexShrink: 0,
            transition: "color var(--duration-fast)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = "var(--color-on-dark)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = "var(--color-on-dark-soft)";
          }}
        >
          <Settings size={16} strokeWidth={1.5} />
          {showLabels && (
            <span
              style={{
                marginLeft: 8,
                fontSize: 13,
                fontFamily: "var(--font-sans)",
                whiteSpace: "nowrap",
              }}
            >
              Paramètres
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
