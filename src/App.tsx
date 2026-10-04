import { Sidebar } from "./components/Sidebar";
import { PanelGrid } from "./components/PanelGrid";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";

export default function App() {
  useKeyboardShortcuts();

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        overflow: "hidden",
        background: "var(--color-surface-dark)",
      }}
    >
      <Sidebar />
      <main
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          borderLeft: "1px solid rgba(255,255,255,0.03)",
        }}
      >
        <PanelGrid />
      </main>
      <SettingsDrawer />
    </div>
  );
}
