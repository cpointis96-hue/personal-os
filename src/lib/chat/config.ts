export type ChatProvider = "auth" | "claude" | "openai" | "gemini";
export type ChatApiProvider = "openrouter";

export interface OpenRouterModel {
  id: string;
  name: string;
  context_length?: number | null;
  description?: string | null;
  is_free?: boolean;
  is_light?: boolean;
}

export const CHAT_SETTINGS_KEYS = {
  provider: "chat_provider",
  apiProvider: "chat_api_provider",
  openrouterApiKey: "openrouter_api_key",
  openrouterModel: "openrouter_model",
  authSessionEnabled: "chat_auth_session_enabled",
  authSessionLabel: "chat_auth_session_label",
  factcheckPrompt: "fact_check_prompt",
  freePrompt: "free_chat_prompt",
  legacyClaudeApiKey: "claude_api_key",
  legacyClaudeModel: "claude_model",
} as const;

export const CHAT_PROVIDER_OPTIONS: Array<{ value: ChatProvider; label: string }> = [
  { value: "auth", label: "AUTH" },
  { value: "claude", label: "Claude" },
  { value: "openai", label: "OpenAI" },
  { value: "gemini", label: "Gemini" },
];

export const CHAT_API_PROVIDER_OPTIONS: Array<{ value: ChatApiProvider; label: string }> = [
  { value: "openrouter", label: "OpenRouter" },
];

export const DEFAULT_FACTCHECK_PROMPT =
  "Tu es un fact-checker rigoureux. Analyse le tweet suivant et identifie les affirmations vérifiables, évalue leur exactitude, et fournis des sources si possible. Sois concis et factuel.";

export const DEFAULT_FREE_PROMPT = "Tu es un assistant utile et concis.";

export const OPENROUTER_AUTO_MODEL = "openrouter/auto";

export function getOpenRouterFamilyLabel(modelId: string): string {
  if (modelId === OPENROUTER_AUTO_MODEL) return "auto";
  if (modelId.startsWith("google/")) return "gemma";
  if (modelId.startsWith("moonshotai/")) return "kimi";
  if (modelId.startsWith("z-ai/")) return "glm";
  if (modelId.startsWith("qwen/")) return "qwen";
  if (modelId.startsWith("openai/")) return "openai";
  if (modelId.startsWith("anthropic/")) return "claude";
  return "other";
}
