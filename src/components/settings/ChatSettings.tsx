import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { settings } from "../../lib/db/settings";
import { migrateLegacyChatSettings } from "../../lib/chat/migrate";
import {
  CHAT_API_PROVIDER_OPTIONS,
  CHAT_PROVIDER_OPTIONS,
  CHAT_SETTINGS_KEYS,
  DEFAULT_FACTCHECK_PROMPT,
  DEFAULT_FREE_PROMPT,
  OPENROUTER_AUTO_MODEL,
  type ChatApiProvider,
  type ChatProvider,
  type OpenRouterModel,
} from "../../lib/chat/config";

interface ToastState {
  message: string;
  kind?: "info" | "error";
}

function Toast({ message, kind = "info", onDone }: ToastState & { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2200);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        background:
          kind === "error" ? "rgba(122, 45, 45, 0.96)" : "var(--color-surface-dark-elevated)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 8,
        padding: "8px 16px",
        fontSize: 13,
        fontFamily: "var(--font-sans)",
        color: "var(--color-on-dark)",
        zIndex: 9999,
        boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
      }}
    >
      {message}
    </div>
  );
}

function ProviderHint({ provider }: { provider: ChatProvider }) {
  const text =
    provider === "auth"
      ? "AUTH est réservé au futur OAuth persistant. Le moteur actuel passe toujours par OpenRouter."
      : provider === "claude"
        ? "Profil Claude via OpenRouter."
        : provider === "openai"
          ? "Profil OpenAI via OpenRouter."
          : "Profil Gemini via OpenRouter.";

  return (
    <div
      style={{
        marginTop: 8,
        padding: "10px 12px",
        borderRadius: 8,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.06)",
        fontSize: 12,
        lineHeight: 1.5,
        color: "var(--color-on-dark-soft)",
      }}
    >
      {text}
    </div>
  );
}

export function ChatSettings() {
  const [provider, setProvider] = useState<ChatProvider>("openai");
  const [apiProvider, setApiProvider] = useState<ChatApiProvider>("openrouter");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(OPENROUTER_AUTO_MODEL);
  const [modelQuery, setModelQuery] = useState("");
  const [modelFilter, setModelFilter] = useState<"all" | "free" | "light">("all");
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [authSessionEnabled, setAuthSessionEnabled] = useState(false);
  const [authSessionLabel, setAuthSessionLabel] = useState("");
  const [factcheckPrompt, setFactcheckPrompt] = useState(DEFAULT_FACTCHECK_PROMPT);
  const [freePrompt, setFreePrompt] = useState(DEFAULT_FREE_PROMPT);
  const [models, setModels] = useState<OpenRouterModel[]>([
    { id: OPENROUTER_AUTO_MODEL, name: "Sélection automatique" },
  ]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const requestId = useRef(0);
  const modelPickerRef = useRef<HTMLDivElement>(null);

  const save = async (key: string, value: unknown) => {
    await settings.set(key, value);
  };

  const normalizeModelList = (items: OpenRouterModel[], nextProvider: ChatProvider) => {
    void nextProvider;
    const deduped = items.filter(
      (item, index, array) => array.findIndex((candidate) => candidate.id === item.id) === index,
    );
    return [
      { id: OPENROUTER_AUTO_MODEL, name: "Sélection automatique" },
      ...deduped.sort((a, b) => a.name.localeCompare(b.name, "fr")),
    ];
  };

  const loadModels = async (nextProvider: ChatProvider, nextApiKey: string) => {
    const current = ++requestId.current;
    setModelsLoading(true);
    setModelsError(null);

    try {
      const response = await invoke<OpenRouterModel[]>("openrouter_models", {
        provider: nextProvider,
        apiKey: nextApiKey || null,
      });

      if (current !== requestId.current) return;

      const nextModels = normalizeModelList(response, nextProvider);
      setModels(nextModels);

      setModel((currentModel) => {
        if (nextModels.some((item) => item.id === currentModel)) return currentModel;
        const fallback = nextModels[0]?.id ?? OPENROUTER_AUTO_MODEL;
        void save(CHAT_SETTINGS_KEYS.openrouterModel, fallback);
        return fallback;
      });
    } catch (error) {
      if (current !== requestId.current) return;
      setModels([{ id: OPENROUTER_AUTO_MODEL, name: "Sélection automatique" }]);
      setModel(OPENROUTER_AUTO_MODEL);
      void save(CHAT_SETTINGS_KEYS.openrouterModel, OPENROUTER_AUTO_MODEL);
      setModelsError(
        error instanceof Error ? error.message : "Impossible de charger les modèles OpenRouter.",
      );
    } finally {
      if (current === requestId.current) {
        setModelsLoading(false);
      }
    }
  };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      await migrateLegacyChatSettings();
      const [
        savedProvider,
        savedApiProvider,
        savedApiKey,
        savedModel,
        savedAuthSessionEnabled,
        savedAuthSessionLabel,
        savedFactcheck,
        savedFree,
      ] = await Promise.all([
        settings.get<ChatProvider>(CHAT_SETTINGS_KEYS.provider),
        settings.get<ChatApiProvider>(CHAT_SETTINGS_KEYS.apiProvider),
        settings.get<string>(CHAT_SETTINGS_KEYS.openrouterApiKey),
        settings.get<string>(CHAT_SETTINGS_KEYS.openrouterModel),
        settings.get<boolean>(CHAT_SETTINGS_KEYS.authSessionEnabled),
        settings.get<string>(CHAT_SETTINGS_KEYS.authSessionLabel),
        settings.get<string>(CHAT_SETTINGS_KEYS.factcheckPrompt),
        settings.get<string>(CHAT_SETTINGS_KEYS.freePrompt),
      ]);

      if (cancelled) return;

      if (savedProvider) setProvider(savedProvider);
      if (savedApiProvider) setApiProvider(savedApiProvider);
      if (savedApiKey) setApiKey(savedApiKey);
      if (savedModel) setModel(savedModel);
      if (savedAuthSessionEnabled !== null) setAuthSessionEnabled(savedAuthSessionEnabled);
      if (savedAuthSessionLabel) setAuthSessionLabel(savedAuthSessionLabel);
      if (savedFactcheck) setFactcheckPrompt(savedFactcheck);
      if (savedFree) setFreePrompt(savedFree);
      void loadModels(savedProvider ?? "openai", savedApiKey ?? "");
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 6,
    padding: "6px 10px",
    fontSize: 12,
    fontFamily: "var(--font-sans)",
    color: "var(--color-on-dark)",
    outline: "none",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    color: "var(--color-on-dark-soft)",
    marginBottom: 4,
    display: "block",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  };

  const fieldStyle: React.CSSProperties = { marginBottom: 16 };
  const filteredModels = useMemo(() => {
    const query = modelQuery.trim().toLowerCase();
    return models.filter((item) => {
      if (modelFilter === "free" && !item.is_free) return false;
      if (modelFilter === "light" && !item.is_light) return false;
      if (query && !(`${item.id} ${item.name}`.toLowerCase().includes(query))) return false;
      return true;
    });
  }, [models, modelFilter, modelQuery]);

  useEffect(() => {
    if (!modelPickerOpen) return;
    const handler = (event: MouseEvent) => {
      if (modelPickerRef.current && !modelPickerRef.current.contains(event.target as Node)) {
        setModelPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [modelPickerOpen]);

  return (
    <div style={{ paddingTop: 8 }}>
      <div style={fieldStyle}>
        <label style={labelStyle}>Provider de chat</label>
        <select
          value={provider}
          onChange={(e) => {
            const nextProvider = e.target.value as ChatProvider;
            setProvider(nextProvider);
            void save(CHAT_SETTINGS_KEYS.provider, nextProvider);
            void loadModels(nextProvider, apiKey);
          }}
          style={{ ...inputStyle, cursor: "pointer" }}
        >
          {CHAT_PROVIDER_OPTIONS.map((item) => (
            <option key={item.value} value={item.value} style={{ background: "#252320" }}>
              {item.label}
            </option>
          ))}
        </select>
        <ProviderHint provider={provider} />
      </div>

      {provider === "auth" && (
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(255,255,255,0.03)",
          }}
        >
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-on-dark-soft)", marginBottom: 8 }}>
            Session AUTH locale
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--color-on-dark-soft)", marginBottom: 8 }}>
            Ce bloc mémorise une session locale pour préparer un vrai OAuth plus tard. Il ne remplace pas un login externe.
          </div>
          <input
            type="text"
            value={authSessionLabel}
            onChange={(e) => setAuthSessionLabel(e.target.value)}
            placeholder="Nom de session ou compte"
            style={{ ...inputStyle, marginBottom: 8 }}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={async () => {
                setAuthSessionEnabled(true);
                await save(CHAT_SETTINGS_KEYS.authSessionEnabled, true);
                await save(CHAT_SETTINGS_KEYS.authSessionLabel, authSessionLabel.trim());
                setToast({ message: "Session AUTH mémorisée" });
              }}
              style={{
                background: "rgba(204,120,92,0.16)",
                border: "1px solid rgba(204,120,92,0.4)",
                borderRadius: 6,
                padding: "6px 12px",
                fontSize: 12,
                fontFamily: "var(--font-sans)",
                color: "var(--color-on-dark)",
                cursor: "pointer",
              }}
            >
              Activer
            </button>
            <button
              type="button"
              onClick={async () => {
                setAuthSessionEnabled(false);
                setAuthSessionLabel("");
                await settings.delete(CHAT_SETTINGS_KEYS.authSessionEnabled);
                await settings.delete(CHAT_SETTINGS_KEYS.authSessionLabel);
                setToast({ message: "Session AUTH effacée" });
              }}
              style={{
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 6,
                padding: "6px 12px",
                fontSize: 12,
                fontFamily: "var(--font-sans)",
                color: "var(--color-on-dark-soft)",
                cursor: "pointer",
              }}
            >
              Déconnecter
            </button>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--color-on-dark-soft)" }}>
            État: {authSessionEnabled ? "connecté localement" : "non connecté"}
          </div>
        </div>
      )}

      <div style={fieldStyle}>
        <label style={labelStyle}>API connectée</label>
        <select
          value={apiProvider}
          onChange={(e) => {
            const nextApiProvider = e.target.value as ChatApiProvider;
            setApiProvider(nextApiProvider);
            void save(CHAT_SETTINGS_KEYS.apiProvider, nextApiProvider);
          }}
          style={{ ...inputStyle, cursor: "pointer" }}
        >
          {CHAT_API_PROVIDER_OPTIONS.map((item) => (
            <option key={item.value} value={item.value} style={{ background: "#252320" }}>
              {item.label}
            </option>
          ))}
        </select>
        <div
          style={{
            marginTop: 8,
            fontSize: 12,
            lineHeight: 1.5,
            color: "var(--color-on-dark-soft)",
          }}
        >
          OpenRouter est le seul backend branché pour l'instant.
        </div>
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>Clé API OpenRouter</label>
        <input
          type="password"
          value={apiKey}
          placeholder="sk-or-v1-..."
          onChange={(e) => setApiKey(e.target.value)}
          onBlur={async () => {
            await save(CHAT_SETTINGS_KEYS.openrouterApiKey, apiKey);
            await settings.delete(CHAT_SETTINGS_KEYS.legacyClaudeApiKey);
            await settings.delete(CHAT_SETTINGS_KEYS.legacyClaudeModel);
            setToast({ message: "Clé OpenRouter sauvegardée" });
            void loadModels(provider, apiKey);
          }}
          style={inputStyle}
        />
      </div>

      <div style={fieldStyle}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: 12,
            marginBottom: 4,
          }}
        >
          <label style={{ ...labelStyle, marginBottom: 0 }}>Modèle OpenRouter</label>
          {modelsLoading && (
            <span style={{ fontSize: 11, color: "var(--color-on-dark-soft)" }}>Chargement...</span>
          )}
        </div>
        <div ref={modelPickerRef} style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setModelPickerOpen((v) => !v)}
            style={{
              ...inputStyle,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <span style={{ minWidth: 0, textAlign: "left" }}>
              {models.find((item) => item.id === model)?.name ?? "Sélection automatique"}
            </span>
            <span style={{ color: "var(--color-on-dark-soft)", fontSize: 12 }}>
              {modelPickerOpen ? "▴" : "▾"}
            </span>
          </button>

          {modelPickerOpen && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 8px)",
                left: 0,
                right: 0,
                zIndex: 40,
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.06)",
                background: "var(--color-surface-dark-elevated)",
                boxShadow: "0 16px 40px rgba(0,0,0,0.45)",
                overflow: "hidden",
              }}
              >
              <div style={{ padding: 10, borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="text"
                    value={modelQuery}
                    onChange={(e) => setModelQuery(e.target.value)}
                    placeholder="Rechercher un modèle..."
                    style={{ ...inputStyle, flex: 1, minWidth: 0 }}
                  />
                  <div style={{ position: "relative", flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={() => setFilterMenuOpen((v) => !v)}
                      style={{
                        height: 32,
                        minWidth: 72,
                        padding: "0 10px",
                        borderRadius: 8,
                        border: "1px solid rgba(255,255,255,0.08)",
                        background: "rgba(255,255,255,0.03)",
                        color: "var(--color-on-dark-soft)",
                        fontSize: 12,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                      }}
                      >
                      <span>{modelFilter === "all" ? "Tous" : modelFilter === "free" ? "Free" : "Light"}</span>
                      <span style={{ fontSize: 10, opacity: 0.8 }}>▾</span>
                    </button>
                    {filterMenuOpen && (
                      <div
                        style={{
                          position: "absolute",
                          top: "calc(100% + 6px)",
                          right: 0,
                          zIndex: 50,
                          minWidth: 96,
                          borderRadius: 8,
                          border: "1px solid rgba(255,255,255,0.06)",
                          background: "var(--color-surface-dark-elevated)",
                          boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
                          overflow: "hidden",
                        }}
                      >
                        {([
                          ["all", "Tous"],
                          ["free", "Free"],
                          ["light", "Light"],
                        ] as const).map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => {
                              setModelFilter(value);
                              setFilterMenuOpen(false);
                            }}
                            style={{
                              width: "100%",
                              height: 32,
                              padding: "0 10px",
                              border: "none",
                              background:
                                modelFilter === value ? "rgba(204,120,92,0.16)" : "transparent",
                              color:
                                modelFilter === value
                                  ? "var(--color-on-dark)"
                                  : "var(--color-on-dark-soft)",
                              textAlign: "left",
                              cursor: "pointer",
                              fontSize: 12,
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div style={{ maxHeight: 260, overflowY: "auto" }}>
                {filteredModels.length === 0 ? (
                  <div style={{ padding: 12, fontSize: 12, color: "var(--color-on-dark-soft)" }}>
                    Aucun modèle ne correspond.
                  </div>
                ) : (
                  filteredModels.map((item) => {
                    const active = item.id === model;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setModel(item.id);
                          setModelPickerOpen(false);
                          void save(CHAT_SETTINGS_KEYS.openrouterModel, item.id);
                        }}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          padding: "10px 12px",
                          background: active ? "rgba(204,120,92,0.15)" : "transparent",
                          border: "none",
                          borderBottom: "1px solid rgba(255,255,255,0.04)",
                          cursor: "pointer",
                          color: "var(--color-on-dark)",
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.35 }}>
                            {item.name}
                          </div>
                          <div
                            style={{
                              marginTop: 2,
                              fontSize: 11,
                              color: "var(--color-on-dark-soft)",
                              fontFamily: "var(--font-mono)",
                              wordBreak: "break-all",
                            }}
                          >
                            {item.id}
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
        <div
          style={{
            marginTop: 8,
            fontSize: 12,
            lineHeight: 1.5,
            color: "var(--color-on-dark-soft)",
          }}
        >
          L’affichage est trié pour faire remonter les modèles gratuits et légers. Tu peux garder
          <span style={{ fontFamily: "var(--font-mono)", padding: "0 4px" }}>{OPENROUTER_AUTO_MODEL}</span>
          pour le routage automatique.
        </div>
        {modelsError && (
          <div
            style={{
              marginTop: 8,
              fontSize: 12,
              lineHeight: 1.5,
              color: "rgb(255,170,170)",
            }}
          >
            {modelsError}
          </div>
        )}
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>Prompt fact-check</label>
        <textarea
          value={factcheckPrompt}
          onChange={(e) => setFactcheckPrompt(e.target.value)}
          onBlur={async () => {
            await save(CHAT_SETTINGS_KEYS.factcheckPrompt, factcheckPrompt);
          }}
          rows={4}
          style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
        />
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>Prompt chat libre</label>
        <textarea
          value={freePrompt}
          onChange={(e) => setFreePrompt(e.target.value)}
          onBlur={async () => {
            await save(CHAT_SETTINGS_KEYS.freePrompt, freePrompt);
          }}
          rows={3}
          style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
        />
      </div>

      <button
        onClick={async () => {
          setFactcheckPrompt(DEFAULT_FACTCHECK_PROMPT);
          setFreePrompt(DEFAULT_FREE_PROMPT);
          await save(CHAT_SETTINGS_KEYS.factcheckPrompt, DEFAULT_FACTCHECK_PROMPT);
          await save(CHAT_SETTINGS_KEYS.freePrompt, DEFAULT_FREE_PROMPT);
          setToast({ message: "Prompts réinitialisés" });
        }}
        style={{
          background: "none",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 6,
          padding: "5px 12px",
          fontSize: 12,
          fontFamily: "var(--font-sans)",
          color: "var(--color-on-dark-soft)",
          cursor: "pointer",
        }}
      >
        Réinitialiser les prompts
      </button>

      {toast && <Toast message={toast.message} kind={toast.kind} onDone={() => setToast(null)} />}
    </div>
  );
}
