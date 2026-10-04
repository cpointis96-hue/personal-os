import { settings } from "../db/settings";
import {
  CHAT_SETTINGS_KEYS,
  OPENROUTER_AUTO_MODEL,
  type ChatProvider,
} from "./config";

function inferProviderFromLegacyModel(model: string | null): ChatProvider | null {
  if (!model) return null;
  if (model.includes("claude")) return "claude";
  if (model.includes("gpt") || model.startsWith("openai/")) return "openai";
  if (model.includes("gemini") || model.startsWith("google/")) return "gemini";
  return null;
}

function mapLegacyModel(model: string | null): string {
  if (!model) return OPENROUTER_AUTO_MODEL;
  if (model.startsWith("anthropic/") || model.startsWith("openai/") || model.startsWith("google/")) {
    return model;
  }
  return OPENROUTER_AUTO_MODEL;
}

export async function migrateLegacyChatSettings(): Promise<ChatProvider | null> {
  const [legacyApiKey, legacyModel, currentProvider, currentApiProvider, currentApiKey, currentModel] =
    await Promise.all([
      settings.get<string>(CHAT_SETTINGS_KEYS.legacyClaudeApiKey),
      settings.get<string>(CHAT_SETTINGS_KEYS.legacyClaudeModel),
      settings.get<ChatProvider>(CHAT_SETTINGS_KEYS.provider),
      settings.get<string>(CHAT_SETTINGS_KEYS.apiProvider),
      settings.get<string>(CHAT_SETTINGS_KEYS.openrouterApiKey),
      settings.get<string>(CHAT_SETTINGS_KEYS.openrouterModel),
    ]);

  const legacyProvider = inferProviderFromLegacyModel(legacyModel) ?? (legacyApiKey ? "claude" : null);
  let migratedProvider: ChatProvider | null = currentProvider ?? legacyProvider;

  if (!currentApiProvider) {
    await settings.set(CHAT_SETTINGS_KEYS.apiProvider, "openrouter");
  }

  if (legacyApiKey && !currentApiKey) {
    await settings.set(CHAT_SETTINGS_KEYS.openrouterApiKey, legacyApiKey);
  }

  if (legacyModel && !currentModel) {
    await settings.set(CHAT_SETTINGS_KEYS.openrouterModel, mapLegacyModel(legacyModel));
  }

  if (legacyProvider && !currentProvider) {
    await settings.set(CHAT_SETTINGS_KEYS.provider, legacyProvider);
  }

  if (legacyApiKey || legacyModel) {
    await settings.delete(CHAT_SETTINGS_KEYS.legacyClaudeApiKey);
    await settings.delete(CHAT_SETTINGS_KEYS.legacyClaudeModel);
  }

  if (!migratedProvider && (currentApiKey || legacyApiKey)) {
    migratedProvider = "openai";
    await settings.set(CHAT_SETTINGS_KEYS.provider, migratedProvider);
  }

  return migratedProvider;
}

