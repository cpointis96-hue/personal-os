import { GripVertical, X } from "lucide-react";
import type { ReactNode } from "react";
import { usePanelStore, type PanelType } from "../stores/panelStore";
import { BrowserPanel } from "./BrowserPanel";
import { BrowserPanelHeader } from "./BrowserPanelHeader";
import { ChatIAPanel } from "./ChatIAPanel";
import { EmptyPanel } from "./EmptyPanel";
import { TerminalPanel } from "./TerminalPanel";
import { XFeedPanel } from "./XFeedPanel";
import { YouTubePanel } from "./YouTubePanel";
import { YtdlpPanel } from "./YtdlpPanel";

interface PanelProps {
  id: string;
  title: string;
  type: PanelType;
  children?: ReactNode;
  onClose: () => void;
}

export function Panel({ id, title, type, onClose }: PanelProps) {
  const focusedPanelId = usePanelStore((s) => s.focusedPanelId);
  const focusPanel = usePanelStore((s) => s.focusPanel);
  const panelMeta = usePanelStore((s) => s.panels.find((p) => p.id === id)?.meta);
  const isFocused = focusedPanelId === id;

  return (
    <div
      onClick={() => focusPanel(id)}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        borderRadius: "var(--radius-md)",
        border: `1px solid ${isFocused ? "var(--color-primary)" : "transparent"}`,
        overflow: "hidden",
        transition: "border-color var(--duration-fast), box-shadow var(--duration-fast)",
      }}
      onMouseEnter={(e) => {
        if (!isFocused) {
          (e.currentTarget as HTMLDivElement).style.boxShadow = "0 0 0 1px rgba(255,255,255,0.05)";
        }
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
      }}
    >
      <div
        style={{
          height: type === "browser" ? 44 : 36,
          background: "var(--color-surface-dark-elevated)",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          padding: "0 10px",
          display: "flex",
          alignItems: "center",
          flexShrink: 0,
          cursor: "grab",
          userSelect: "none",
        }}
        className="panel-header drag-handle"
      >
        <span
          style={{
            color: "var(--color-on-dark-soft)",
            opacity: 0.65,
            display: "flex",
            alignItems: "center",
            pointerEvents: "none",
            marginRight: 8,
          }}
        >
          <GripVertical size={14} strokeWidth={1.5} />
        </span>
        {type === "browser" ? (
          <BrowserPanelHeader panelId={id} />
        ) : (
          <span
            style={{
              flex: 1,
              fontSize: 13,
              fontFamily: "var(--font-sans)",
              color: "var(--color-on-dark-soft)",
              textAlign: "center",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              pointerEvents: "none",
            }}
          >
            {title}
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="panel-close-btn panel-header-action"
          style={{
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            color: "var(--color-on-dark)",
            opacity: 0,
            transition: "opacity var(--duration-fast)",
          }}
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>
      <div
        style={{
          flex: 1,
          background: "var(--color-surface-dark-soft)",
          overflowY:
            type === "terminal" ||
            type === "chat" ||
            type === "x" ||
            type === "youtube" ||
            type === "ytdlp" ||
            type === "browser"
              ? "hidden"
              : "auto",
          overflow:
            type === "terminal" ||
            type === "chat" ||
            type === "x" ||
            type === "youtube" ||
            type === "ytdlp" ||
            type === "browser"
              ? "hidden"
              : undefined,
        }}
        className="panel-content"
      >
        {type === null ? (
          <EmptyPanel panelId={id} />
        ) : type === "terminal" ? (
          <TerminalPanel panelId={id} />
        ) : type === "chat" ? (
          <ChatIAPanel panelId={id} initialContext={panelMeta?.initialContext} />
        ) : type === "x" ? (
          <XFeedPanel panelId={id} />
        ) : type === "youtube" ? (
          <YouTubePanel panelId={id} />
        ) : type === "ytdlp" ? (
          <YtdlpPanel />
        ) : type === "browser" ? (
          <BrowserPanel panelId={id} />
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "var(--color-on-dark-soft)",
              fontSize: 13,
              fontFamily: "var(--font-sans)",
            }}
          >
            Panel {type}
          </div>
        )}
      </div>
    </div>
  );
}
