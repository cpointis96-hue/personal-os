import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ChatInitialContext } from "../panels/ChatIAPanel";

export const DEFAULT_BROWSER_URL = "https://example.com";

export type PanelType = "x" | "youtube" | "terminal" | "ytdlp" | "chat" | "browser" | null;

export interface BrowserPanelState {
  url: string;
}

export interface PanelMeta {
  selectedListId?: number;
  initialContext?: ChatInitialContext;
  initialUrl?: string;
  browserState?: BrowserPanelState;
}

export interface Panel {
  id: string;
  type: PanelType;
  title: string;
  meta?: PanelMeta;
}

interface PanelStore {
  panels: Panel[];
  focusedPanelId: string | null;
  sidebarCollapsed: boolean;
  settingsOpen: boolean;
  addPanel: () => void;
  addBrowserPanel: () => void;
  addTerminalPanel: () => void;
  addChatPanel: () => void;
  addXFeedPanel: () => void;
  addYouTubePanel: () => void;
  openFactCheckChat: (context: ChatInitialContext) => void;
  updatePanelMeta: (id: string, meta: Partial<PanelMeta>) => void;
  updatePanelTitle: (id: string, title: string) => void;
  removePanel: (id: string) => void;
  focusPanel: (id: string) => void;
  setType: (id: string, type: PanelType) => void;
  setSettingsOpen: (open: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
}

function getDefaultPanelTitle(type: PanelType): string {
  switch (type) {
    case "x":
      return "X Feed";
    case "youtube":
      return "YouTube";
    case "terminal":
      return "Terminal";
    case "ytdlp":
      return "yt-dlp";
    case "chat":
      return "Chat IA";
    case "browser":
      return "Browser";
    default:
      return "Nouveau";
  }
}

function getDefaultPanelMeta(type: PanelType): PanelMeta | undefined {
  if (type !== "browser") return undefined;
  return {
    initialUrl: DEFAULT_BROWSER_URL,
    browserState: { url: DEFAULT_BROWSER_URL },
  };
}

export const usePanelStore = create<PanelStore>()(
  persist(
    (set, _get) => ({
      panels: [],
      focusedPanelId: null,
      sidebarCollapsed: true,
      settingsOpen: false,
      addPanel: () =>
        set((s) => ({
          panels: [...s.panels, { id: crypto.randomUUID(), type: null, title: "Nouveau" }],
        })),
      addBrowserPanel: () =>
        set((s) => ({
          panels: [
            ...s.panels,
            {
              id: crypto.randomUUID(),
              type: "browser",
              title: getDefaultPanelTitle("browser"),
              meta: getDefaultPanelMeta("browser"),
            },
          ],
        })),
      addTerminalPanel: () =>
        set((s) => ({
          panels: [
            ...s.panels,
            { id: crypto.randomUUID(), type: "terminal", title: getDefaultPanelTitle("terminal") },
          ],
        })),
      addChatPanel: () =>
        set((s) => ({
          panels: [...s.panels, { id: crypto.randomUUID(), type: "chat", title: getDefaultPanelTitle("chat") }],
        })),
      addXFeedPanel: () =>
        set((s) => ({
          panels: [...s.panels, { id: crypto.randomUUID(), type: "x", title: getDefaultPanelTitle("x") }],
        })),
      addYouTubePanel: () =>
        set((s) => ({
          panels: [
            ...s.panels,
            { id: crypto.randomUUID(), type: "youtube", title: getDefaultPanelTitle("youtube") },
          ],
        })),
      openFactCheckChat: (context) => {
        const newId = crypto.randomUUID();
        const title = `Fact-check: @${context.authorHandle}`;
        set((s) => ({
          panels: [
            ...s.panels,
            { id: newId, type: "chat", title, meta: { initialContext: context } },
          ],
          focusedPanelId: newId,
        }));
      },
      updatePanelMeta: (id, meta) =>
        set((s) => ({
          panels: s.panels.map((p) =>
            p.id === id ? { ...p, meta: { ...p.meta, ...meta } } : p
          ),
        })),
      updatePanelTitle: (id, title) =>
        set((s) => ({
          panels: s.panels.map((p) =>
            p.id === id ? { ...p, title } : p
          ),
        })),
      removePanel: (id) =>
        set((s) => ({
          panels: s.panels.filter((p) => p.id !== id),
          focusedPanelId: s.focusedPanelId === id ? null : s.focusedPanelId,
        })),
      focusPanel: (id) => set({ focusedPanelId: id }),
      setType: (id, type) =>
        set((s) => ({
          panels: s.panels.map((p) =>
            p.id === id
              ? {
                  ...p,
                  type,
                  title: getDefaultPanelTitle(type),
                  meta: type === "browser" ? { ...p.meta, ...getDefaultPanelMeta(type) } : p.meta,
                }
              : p
          ),
        })),
      setSettingsOpen: (open) => set({ settingsOpen: open }),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    { name: "panels" }
  )
);
