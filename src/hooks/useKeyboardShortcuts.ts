import { useEffect } from "react";
import { usePanelStore } from "../stores/panelStore";

export function useKeyboardShortcuts() {
  const { addPanel, removePanel, focusedPanelId, panels, setSettingsOpen, settingsOpen, toggleSidebar } =
    usePanelStore();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.metaKey && e.key !== "Escape") return;
      switch (true) {
        case e.metaKey && e.key === "b":
          e.preventDefault();
          toggleSidebar();
          break;
        case e.metaKey && e.key === ",":
          e.preventDefault();
          setSettingsOpen(true);
          break;
        case e.metaKey && e.key === "n":
          e.preventDefault();
          addPanel();
          break;
        case e.metaKey && e.key === "w":
          e.preventDefault();
          if (focusedPanelId) removePanel(focusedPanelId);
          break;
        case e.key === "Escape":
          if (settingsOpen) setSettingsOpen(false);
          break;
        default: {
          const num = parseInt(e.key, 10);
          if (e.metaKey && num >= 1 && num <= 9) {
            e.preventDefault();
            const panel = panels[num - 1];
            if (panel) usePanelStore.getState().focusPanel(panel.id);
          }
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [addPanel, removePanel, focusedPanelId, panels, setSettingsOpen, settingsOpen, toggleSidebar]);
}
