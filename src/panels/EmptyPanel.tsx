import { Twitter, Youtube, TerminalSquare, Download, MessageSquare, Globe } from "lucide-react";
import { usePanelStore, type PanelType } from "../stores/panelStore";

const PANEL_TYPES: { type: PanelType; label: string; Icon: React.ElementType }[] = [
  { type: "x", label: "X", Icon: Twitter },
  { type: "youtube", label: "YouTube", Icon: Youtube },
  { type: "terminal", label: "Terminal", Icon: TerminalSquare },
  { type: "ytdlp", label: "yt-dlp", Icon: Download },
  { type: "chat", label: "Chat IA", Icon: MessageSquare },
  { type: "browser", label: "Browser", Icon: Globe },
];

export function EmptyPanel({ panelId }: { panelId: string }) {
  const setType = usePanelStore((s) => s.setType);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        gap: 16,
        padding: 16,
      }}
    >
      <span
        style={{
          fontSize: 13,
          color: "var(--color-on-dark-soft)",
          fontFamily: "var(--font-sans)",
        }}
      >
        Choisir un type
      </span>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
        {PANEL_TYPES.map(({ type, label, Icon }) => (
          <button
            key={type}
            onClick={() => setType(panelId, type)}
            style={{
              width: 80,
              height: 72,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              background: "var(--color-surface-dark-elevated)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: "var(--radius-md)",
              cursor: "pointer",
              transition: "border-color var(--duration-fast)",
              color: "var(--color-on-dark)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--color-primary)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.06)";
            }}
          >
            <Icon size={20} strokeWidth={1.5} />
            <span style={{ fontSize: 12, color: "var(--color-on-dark-soft)", fontFamily: "var(--font-sans)" }}>
              {label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
