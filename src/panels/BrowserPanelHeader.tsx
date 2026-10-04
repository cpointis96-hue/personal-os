import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, ArrowRight, Globe, House, RotateCw } from "lucide-react";
import { DEFAULT_BROWSER_URL, usePanelStore } from "../stores/panelStore";
import { formatCompactBrowserUrl, normalizeBrowserInput } from "./browserUtils";

export function BrowserPanelHeader({ panelId }: { panelId: string }) {
  const browserUrl = usePanelStore(
    (s) => s.panels.find((panel) => panel.id === panelId)?.meta?.browserState?.url ?? DEFAULT_BROWSER_URL
  );
  const updatePanelMeta = usePanelStore((s) => s.updatePanelMeta);
  const [inputValue, setInputValue] = useState(browserUrl);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) {
      setInputValue(browserUrl);
    }
  }, [browserUrl, editing]);

  const navigateTo = async (value: string) => {
    const normalizedUrl = normalizeBrowserInput(value);
    setInputValue(normalizedUrl);
    updatePanelMeta(panelId, {
      browserState: { url: normalizedUrl },
      initialUrl: normalizedUrl,
    });
    await invoke("navigate_browser_webview", { panelId, url: normalizedUrl });
  };

  return (
    <div
      className="panel-header-action"
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        gap: 6,
        paddingRight: 8,
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <span
        style={{
          flexShrink: 0,
          fontSize: 11,
          letterSpacing: 0.04,
          color: "var(--color-on-dark-soft)",
          textTransform: "uppercase",
          opacity: 0.7,
        }}
      >
        Browser
      </span>
      {[
        { key: "back", label: "Retour", Icon: ArrowLeft, action: () => invoke("go_back_browser_webview", { panelId }) },
        {
          key: "forward",
          label: "Avancer",
          Icon: ArrowRight,
          action: () => invoke("go_forward_browser_webview", { panelId }),
        },
        { key: "reload", label: "Recharger", Icon: RotateCw, action: () => invoke("reload_browser_webview", { panelId }) },
        { key: "home", label: "Accueil", Icon: House, action: () => navigateTo(DEFAULT_BROWSER_URL) },
      ].map(({ key, label, Icon, action }) => (
        <button
          key={key}
          type="button"
          title={label}
          onClick={() => {
            Promise.resolve(action()).catch(() => {});
          }}
          className="panel-header-action"
          style={{
            width: 24,
            height: 24,
            flexShrink: 0,
            borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.03)",
            color: "var(--color-on-dark-soft)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <Icon size={13} strokeWidth={1.7} />
        </button>
      ))}

      <form
        className="panel-header-action"
        onSubmit={(event) => {
          event.preventDefault();
          setEditing(false);
          void navigateTo(inputValue).catch(() => {});
        }}
        style={{
          flex: 1,
          minWidth: 0,
          height: 26,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 10px",
          borderRadius: 7,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(0,0,0,0.18)",
        }}
      >
        <Globe size={12} strokeWidth={1.7} style={{ flexShrink: 0, color: "var(--color-on-dark-soft)" }} />
        <input
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          onFocus={() => setEditing(true)}
          onBlur={() => {
            setEditing(false);
            setInputValue(
              usePanelStore.getState().panels.find((panel) => panel.id === panelId)?.meta?.browserState?.url ??
                DEFAULT_BROWSER_URL
            );
          }}
          placeholder={formatCompactBrowserUrl(browserUrl)}
          spellCheck={false}
          className="panel-header-action"
          style={{
            flex: 1,
            minWidth: 0,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "var(--color-on-dark)",
            fontSize: 12,
            fontFamily: "var(--font-sans)",
          }}
        />
      </form>
    </div>
  );
}
