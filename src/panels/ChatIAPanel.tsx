import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ArrowDown, ArrowUp, Copy, Paperclip, Square, X } from "lucide-react";
import { chats } from "../lib/db/chats";
import { settings } from "../lib/db/settings";
import { migrateLegacyChatSettings } from "../lib/chat/migrate";
import {
  CHAT_SETTINGS_KEYS,
  DEFAULT_FACTCHECK_PROMPT,
  DEFAULT_FREE_PROMPT,
  OPENROUTER_AUTO_MODEL,
} from "../lib/chat/config";

export interface ChatInitialContext {
  tweetText: string;
  authorHandle: string;
  systemPrompt?: string;
}

interface Props {
  panelId: string;
  initialContext?: ChatInitialContext;
}

interface UIMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  attachments?: ChatAttachment[];
}

interface ChatChunkEvent {
  text: string;
  done: boolean;
  error?: string;
}

interface ChatAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  kind: "text" | "binary";
  content?: string;
  truncated?: boolean;
}

const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "jsonl",
  "csv",
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "css",
  "scss",
  "html",
  "xml",
  "yaml",
  "yml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "log",
  "py",
  "rb",
  "go",
  "rs",
  "sql",
  "sh",
  "bash",
  "zsh",
  "fish",
  "php",
  "swift",
  "kt",
  "java",
]);

const CODE_LANGS: Record<string, string[]> = {
  javascript: ["js", "jsx", "mjs", "cjs"],
  typescript: ["ts", "tsx"],
  json: ["json", "jsonl"],
  bash: ["sh", "bash", "zsh", "fish"],
  css: ["css", "scss"],
  html: ["html", "xml"],
  python: ["py"],
  rust: ["rs"],
  sql: ["sql"],
  yaml: ["yaml", "yml"],
  markdown: ["md", "markdown"],
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

function isTextFile(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return file.type.startsWith("text/") || TEXT_EXTENSIONS.has(ext);
}

function inferLangFromInfo(info: string, code: string): string {
  const lowerInfo = info.toLowerCase().trim();
  if (lowerInfo) {
    if (CODE_LANGS.javascript.includes(lowerInfo)) return "javascript";
    if (CODE_LANGS.typescript.includes(lowerInfo)) return "typescript";
    if (CODE_LANGS.json.includes(lowerInfo)) return "json";
    if (CODE_LANGS.bash.includes(lowerInfo)) return "bash";
    if (CODE_LANGS.css.includes(lowerInfo)) return "css";
    if (CODE_LANGS.html.includes(lowerInfo)) return "html";
    if (CODE_LANGS.python.includes(lowerInfo)) return "python";
    if (CODE_LANGS.rust.includes(lowerInfo)) return "rust";
    if (CODE_LANGS.sql.includes(lowerInfo)) return "sql";
    if (CODE_LANGS.yaml.includes(lowerInfo)) return "yaml";
    if (CODE_LANGS.markdown.includes(lowerInfo)) return "markdown";
  }

  const trimmed = code.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  if (trimmed.startsWith("#!")) return "bash";
  if (/^\s*SELECT\s+/im.test(code) || /^\s*WITH\s+/im.test(code)) return "sql";
  if (/^\s*def\s+\w+/m.test(code) || /import\s+\w+/.test(code)) return "python";
  if (/^\s*fn\s+\w+/m.test(code) || /use\s+\w+::/.test(code)) return "rust";
  if (/^\s*<\w+[\s>]/m.test(code)) return "html";
  if (/^\s*\w+\s*:\s*/m.test(code) && code.includes("\n")) return "yaml";
  if (/\bconst\b|\blet\b|\bfunction\b|=>/.test(code)) return "javascript";
  return "text";
}

function tokenizeCodeLine(line: string, language: string): ReactNode[] {
  const keywordsByLang: Record<string, string[]> = {
    javascript: ["const", "let", "var", "function", "return", "if", "else", "for", "while", "class", "new", "async", "await", "import", "from", "export", "try", "catch", "throw", "type", "interface", "extends", "implements", "switch", "case", "break", "continue", "default", "typeof", "instanceof", "null", "undefined", "true", "false"],
    typescript: ["const", "let", "var", "function", "return", "if", "else", "for", "while", "class", "new", "async", "await", "import", "from", "export", "try", "catch", "throw", "type", "interface", "extends", "implements", "switch", "case", "break", "continue", "default", "typeof", "instanceof", "null", "undefined", "true", "false", "readonly", "public", "private", "protected", "as"],
    json: ["true", "false", "null"],
    bash: ["if", "then", "fi", "for", "in", "do", "done", "case", "esac", "function", "export", "local", "while", "until", "else", "elif"],
    css: ["display", "position", "flex", "grid", "block", "inline", "none", "absolute", "relative", "sticky", "fixed"],
    python: ["def", "return", "if", "elif", "else", "for", "while", "class", "import", "from", "as", "try", "except", "finally", "with", "lambda", "True", "False", "None"],
    rust: ["fn", "let", "mut", "pub", "impl", "struct", "enum", "match", "use", "mod", "crate", "self", "Self", "ref", "where", "trait", "async", "await", "move", "return", "if", "else", "loop"],
    sql: ["SELECT", "FROM", "WHERE", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "ON", "GROUP", "BY", "ORDER", "LIMIT", "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE", "CREATE", "TABLE", "DROP", "ALTER", "AND", "OR", "NOT", "NULL", "AS", "DISTINCT"],
    html: ["div", "span", "button", "input", "textarea", "pre", "code", "class", "href", "type", "value"],
    yaml: ["true", "false", "null"],
    markdown: [],
    text: [],
  };

  const keywords = keywordsByLang[language] ?? [];
  const keywordPattern = keywords.length > 0 ? keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") : "(?!)";
  const tokenRegex = new RegExp(
    [
      "//.*$",
      "#.*$",
      "/\\*[\\s\\S]*?\\*/",
      "\"(?:\\\\.|[^\"])*\"",
      "'(?:\\\\.|[^'])*'",
      "`(?:\\\\.|[^`])*`",
      `\\b(?:${keywordPattern})\\b`,
      "\\b\\d+(?:\\.\\d+)?\\b",
      "[{}()[\\];,.<>:+\\-*/=%&|^!?~]+",
    ].join("|"),
    "g",
  );

  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(line)) !== null) {
    const token = match[0];
    const index = match.index;
    if (index > lastIndex) {
      nodes.push(<span key={`plain-${lastIndex}`}>{line.slice(lastIndex, index)}</span>);
    }

    let color = "var(--color-on-dark)";
    if (token.startsWith("//") || token.startsWith("#") || token.startsWith("/*")) {
      color = "rgba(160,157,150,0.85)";
    } else if (/^["'`]/.test(token)) {
      color = "var(--color-accent-amber)";
    } else if (keywords.includes(token) || keywords.includes(token.toUpperCase())) {
      color = "var(--color-primary)";
    } else if (/^\d/.test(token)) {
      color = "var(--color-accent-teal)";
    } else if (/^[{}()[\];,.<>:+\-*/=%&|^!?~]+$/.test(token)) {
      color = "rgba(250,249,245,0.66)";
    }

    nodes.push(
      <span key={`tok-${index}`} style={{ color }}>
        {token}
      </span>,
    );
    lastIndex = index + token.length;
  }

  if (lastIndex < line.length) {
    nodes.push(<span key={`tail-${lastIndex}`}>{line.slice(lastIndex)}</span>);
  }

  return nodes;
}

function InlineContent({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith("*") && part.endsWith("*")) {
          return <em key={i}>{part.slice(1, -1)}</em>;
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code
              key={i}
              style={{
                background: "rgba(255,255,255,0.06)",
                padding: "1px 5px",
                borderRadius: 5,
                fontSize: 11,
                fontFamily: "var(--font-mono)",
              }}
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        const match = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (match) {
          return (
            <a key={i} href={match[2]} style={{ color: "var(--color-primary)", textDecoration: "underline" }}>
              {match[1]}
            </a>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      style={{
        position: "relative",
        margin: "12px 0",
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(0,0,0,0.28)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          color: "var(--color-on-dark-soft)",
          fontSize: 11,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          fontFamily: "var(--font-mono)",
        }}
      >
        <span>{language}</span>
        <span>{formatBytes(code.length)}</span>
      </div>
      <button
        type="button"
        onClick={copy}
        title="Copier le code"
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          width: 28,
          height: 28,
          borderRadius: 999,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.05)",
          color: copied ? "var(--color-success)" : "var(--color-on-dark-soft)",
          display: "grid",
          placeItems: "center",
          cursor: "pointer",
        }}
      >
        <Copy size={12} strokeWidth={1.7} />
      </button>
      <pre
        style={{
          margin: 0,
          padding: "12px 14px 14px",
          overflowX: "auto",
          fontSize: 11,
          lineHeight: 1.65,
          fontFamily: "var(--font-mono)",
          whiteSpace: "pre",
          color: "var(--color-on-dark)",
        }}
      >
        <code>
          {code.split("\n").map((line, index) => (
            <div key={index} style={{ display: "flex", gap: 12 }}>
              <span style={{ opacity: 0.32, flexShrink: 0, minWidth: 24, textAlign: "right" }}>
                {index + 1}
              </span>
              <span style={{ minWidth: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {tokenizeCodeLine(line, language)}
              </span>
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
}

function MarkdownMessage({ text }: { text: string }) {
  const segments = text.split(/(```[\s\S]*?```)/g);

  return (
    <div style={{ lineHeight: 1.7 }}>
      {segments.map((segment, segmentIndex) => {
        if (segment.startsWith("```")) {
          const firstLineEnd = segment.indexOf("\n");
          const info = firstLineEnd > 3 ? segment.slice(3, firstLineEnd) : "";
          const code = segment.slice(3).replace(/^[^\n]*\n?/, "").replace(/```$/, "");
          return <CodeBlock key={segmentIndex} code={code} language={inferLangFromInfo(info, code)} />;
        }

        const lines = segment.split("\n");
        return lines.map((line, lineIndex) => {
          const key = `${segmentIndex}-${lineIndex}`;
          if (line === "") {
            return <div key={key} style={{ height: 7 }} />;
          }
          if (line.startsWith("- ") || line.startsWith("* ")) {
            return (
              <div key={key} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ opacity: 0.35, flexShrink: 0 }}>•</span>
                <span style={{ minWidth: 0 }}>
                  <InlineContent text={line.slice(2)} />
                </span>
              </div>
            );
          }
          return (
            <div key={key}>
              <InlineContent text={line} />
            </div>
          );
        });
      })}
    </div>
  );
}

function ChatBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
      }}
    >
      <div
        style={{
          maxWidth: "min(760px, 82%)",
          padding: isUser ? "10px 12px" : "2px 2px",
          borderRadius: isUser ? 16 : 12,
          background: isUser ? "rgba(255,255,255,0.04)" : "transparent",
          border: isUser ? "1px solid rgba(255,255,255,0.06)" : "none",
          color: "var(--color-on-dark)",
          fontSize: 13,
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {message.role === "assistant" ? (
          <>
            <MarkdownMessage text={message.content || (message.streaming ? "…" : "")} />
            {message.streaming && message.content === "" && (
              <span style={{ opacity: 0.35, fontSize: 11 }}>…</span>
            )}
          </>
        ) : (
          <span>{message.content}</span>
        )}
        {message.attachments && message.attachments.length > 0 && (
          <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
            {message.attachments.map((attachment) => (
              <span
                key={attachment.id}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  maxWidth: "100%",
                  padding: "5px 9px",
                  borderRadius: 999,
                  fontSize: 11,
                  lineHeight: 1.2,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  color: "var(--color-on-dark-soft)",
                }}
                title={`${attachment.name} • ${formatBytes(attachment.size)}`}
              >
                <Paperclip size={11} strokeWidth={1.8} />
                <span style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {attachment.name}
                </span>
                <span style={{ opacity: 0.7 }}>{formatBytes(attachment.size)}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatIAPanel({ panelId: _panelId, initialContext }: Props) {
  const [chatId, setChatId] = useState<number | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState(initialContext?.tweetText ?? "");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [showJumpButton, setShowJumpButton] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const unlistenRef = useRef<(() => void) | null>(null);
  const activeAssistantIdRef = useRef<string | null>(null);
  const accumulatedRef = useRef("");
  const chatIdRef = useRef<number | null>(null);
  const dragCounterRef = useRef(0);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  const processFiles = useCallback(async (files: File[]) => {
    const next = await Promise.all(
      files.map(async (file) => {
        const attachment: ChatAttachment = {
          id: crypto.randomUUID(),
          name: file.name,
          type: file.type || "application/octet-stream",
          size: file.size,
          kind: isTextFile(file) ? "text" : "binary",
        };

        if (attachment.kind === "text") {
          const text = await file.text();
          attachment.truncated = text.length > 12_000;
          attachment.content = attachment.truncated ? `${text.slice(0, 12_000)}\n\n[truncated]` : text;
        }

        return attachment;
      }),
    );

    setAttachments((prev) => [...prev, ...next]);
    setDragActive(false);
    dragCounterRef.current = 0;
  }, []);

  const buildAttachmentContext = useCallback((list: ChatAttachment[]) => {
    if (list.length === 0) return "";
    const payload = list
      .map((attachment) => {
        const header = `- ${attachment.name} (${attachment.type}, ${formatBytes(attachment.size)})`;
        if (attachment.kind !== "text" || !attachment.content) return header;
        return `${header}\n\`\`\`\n${attachment.content}\n\`\`\``;
      })
      .join("\n\n");
    return `\n\n[Fichiers joints]\n${payload}\n`;
  }, []);

  const stopStreaming = useCallback(
    async (keepPartial = true) => {
      const currentChatId = chatIdRef.current;
      if (currentChatId === null) return;

      try {
        await invoke("chat_stop_stream", { chatId: currentChatId });
      } catch {
        // best effort
      }

      unlistenRef.current?.();
      unlistenRef.current = null;

      if (!keepPartial && activeAssistantIdRef.current) {
        const assistantId = activeAssistantIdRef.current;
        setMessages((prev) => prev.filter((msg) => msg.id !== assistantId));
      } else if (activeAssistantIdRef.current) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === activeAssistantIdRef.current ? { ...msg, streaming: false } : msg,
          ),
        );
      }

      activeAssistantIdRef.current = null;
      accumulatedRef.current = "";
      setStreaming(false);
      textareaRef.current?.focus();
    },
    [],
  );

  const startNewChat = useCallback(async () => {
    await stopStreaming(false);
    setMessages([]);
    setInput("");
    setAttachments([]);
    setStickToBottom(true);
    setShowJumpButton(false);
    setDragActive(false);

    const title = initialContext ? `Fact-check: tweet de @${initialContext.authorHandle}` : "Chat libre";
    const contextType = initialContext ? "fact_check" : "free";
    const id = await chats.insert(title, contextType);
    setChatId(id);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [initialContext, stopStreaming]);

  useEffect(() => {
    void startNewChat();
  }, [startNewChat]);

  useEffect(() => {
    chatIdRef.current = chatId;
  }, [chatId]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 168)}px`;
  }, [input]);

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && e.key === "n") {
        e.preventDefault();
        void startNewChat();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [startNewChat]);

  useEffect(() => {
    if (!stickToBottom) return;
    requestAnimationFrame(() => scrollToBottom("auto"));
  }, [messages, streaming, stickToBottom, scrollToBottom]);

  useEffect(() => {
    return () => {
      unlistenRef.current?.();
      unlistenRef.current = null;
      void stopStreaming(false);
    };
  }, [stopStreaming]);

  const handleScroll = useCallback(() => {
    const el = messagesRef.current;
    if (!el) return;
    const delta = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = delta < 48;
    setStickToBottom(atBottom);
    setShowJumpButton(!atBottom);
  }, []);

  const openAttachmentPicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
  }, []);

  const handleFileSelection = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      await processFiles(Array.from(fileList));
    },
    [processFiles],
  );

  const handleDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.dataTransfer.types.includes("Files")) {
      dragCounterRef.current += 1;
      setDragActive(true);
    }
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.dataTransfer.types.includes("Files")) {
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
      if (dragCounterRef.current === 0) {
        setDragActive(false);
      }
    }
  }, []);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes("Files")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setDragActive(true);
    }
  }, []);

  const handleDrop = useCallback(
    async (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragCounterRef.current = 0;
      setDragActive(false);
      const files = Array.from(event.dataTransfer.files ?? []);
      if (files.length === 0) return;
      await processFiles(files);
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [processFiles],
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming || chatId === null) return;

    await migrateLegacyChatSettings();

    const [provider, apiProvider, apiKey, model, authSessionEnabled, factcheckPromptRaw, freeChatPromptRaw] =
      await Promise.all([
        settings.get<string>(CHAT_SETTINGS_KEYS.provider),
        settings.get<string>(CHAT_SETTINGS_KEYS.apiProvider),
        settings.get<string>(CHAT_SETTINGS_KEYS.openrouterApiKey),
        settings.get<string>(CHAT_SETTINGS_KEYS.openrouterModel),
        settings.get<boolean>(CHAT_SETTINGS_KEYS.authSessionEnabled),
        settings.get<string>(CHAT_SETTINGS_KEYS.factcheckPrompt),
        settings.get<string>(CHAT_SETTINGS_KEYS.freePrompt),
      ]);

    if (provider === "auth" && !authSessionEnabled) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            "Le provider AUTH est mémorisé localement pour l’instant. Active la session dans Paramètres → Chat IA.",
        },
      ]);
      return;
    }

    if (apiProvider && apiProvider !== "openrouter") {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "OpenRouter est le seul backend branché pour l’instant.",
        },
      ]);
      return;
    }

    if (!apiKey) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "Clé API OpenRouter non configurée.",
        },
      ]);
      return;
    }

    const systemPrompt =
      initialContext?.systemPrompt ??
      (initialContext ? (factcheckPromptRaw ?? DEFAULT_FACTCHECK_PROMPT) : (freeChatPromptRaw ?? DEFAULT_FREE_PROMPT));

    const messageAttachments = attachments;
    const attachmentContext = buildAttachmentContext(messageAttachments);
    const userMsg: UIMessage = { id: crypto.randomUUID(), role: "user", content: text, attachments: messageAttachments };
    const assistantId = crypto.randomUUID();

    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: assistantId, role: "assistant", content: "", streaming: true },
    ]);
    activeAssistantIdRef.current = assistantId;
    accumulatedRef.current = "";
    setInput("");
    setAttachments([]);
    setStreaming(true);
    requestAnimationFrame(() => scrollToBottom("auto"));
    textareaRef.current?.focus();

    await chats.addMessage(chatId, "user", text);

    const apiMessages = [
      ...messages
        .filter((m) => m.role !== "assistant" || m.content !== "")
        .map((m) => ({
          role: m.role,
          content: m.content,
        })),
      { role: "user", content: `${text}${attachmentContext}` },
    ];

    const unlisten = await listen<ChatChunkEvent>(`chat://chunk/${chatId}`, (event) => {
      const { text: chunk, done, error } = event.payload;

      if (error) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: `⚠ Erreur: ${error}`, streaming: false }
              : m,
          ),
        );
        setStreaming(false);
        activeAssistantIdRef.current = null;
        accumulatedRef.current = "";
        unlistenRef.current?.();
        unlistenRef.current = null;
        return;
      }

      if (!done) {
        accumulatedRef.current += chunk;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: accumulatedRef.current } : m,
          ),
        );
        return;
      }

      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)),
      );
      setStreaming(false);
      activeAssistantIdRef.current = null;
      unlistenRef.current?.();
      unlistenRef.current = null;
      void chats.addMessage(chatId, "assistant", accumulatedRef.current);
      void chats.touch(chatId);
      accumulatedRef.current = "";
      requestAnimationFrame(() => scrollToBottom("smooth"));
    });

    unlistenRef.current = unlisten;

    try {
      await invoke("chat_stream", {
        chatId,
        messages: apiMessages,
        system: systemPrompt,
        model: model ?? OPENROUTER_AUTO_MODEL,
        apiKey,
      });
    } catch (error) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: `⚠ Erreur: ${error instanceof Error ? error.message : "échec du chat"}`,
                streaming: false,
              }
            : m,
        ),
      );
      setStreaming(false);
      activeAssistantIdRef.current = null;
      accumulatedRef.current = "";
      unlistenRef.current?.();
      unlistenRef.current = null;
    }
  }, [input, streaming, chatId, messages, initialContext, scrollToBottom, attachments, buildAttachmentContext]);

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (streaming) {
        void stopStreaming(true);
      } else {
        void send();
      }
    }
  };

  const composerPlaceholder = streaming ? "Génération..." : "Message";

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        position: "relative",
        fontFamily: "var(--font-sans)",
      }}
    >
      {dragActive && (
        <div
          style={{
            position: "absolute",
            inset: 12,
            borderRadius: 20,
            border: "1px dashed rgba(204,120,92,0.45)",
            background: "rgba(24,23,21,0.72)",
            backdropFilter: "blur(6px)",
            display: "grid",
            placeItems: "center",
            color: "var(--color-on-dark)",
            zIndex: 30,
            pointerEvents: "none",
            fontSize: 13,
            letterSpacing: "0.02em",
          }}
        >
          Dépose les fichiers ici
        </div>
      )}

      <div
        ref={messagesRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "18px 18px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {messages.length === 0 && (
          <div
            style={{
              flex: 1,
              display: "grid",
              placeItems: "center",
              color: "var(--color-on-dark-soft)",
              opacity: 0.45,
              fontSize: 12,
              letterSpacing: "0.02em",
            }}
          >
            {initialContext ? `Fact-check du tweet de @${initialContext.authorHandle}` : "Nouvelle conversation"}
          </div>
        )}

        {messages.map((message) => (
          <ChatBubble key={message.id} message={message} />
        ))}
      </div>

      {showJumpButton && (
        <button
          type="button"
          onClick={() => {
            setStickToBottom(true);
            setShowJumpButton(false);
            scrollToBottom("smooth");
          }}
          style={{
            position: "absolute",
            right: 20,
            bottom: 86,
            width: 36,
            height: 36,
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(37,35,32,0.92)",
            boxShadow: "0 10px 28px rgba(0,0,0,0.3)",
            color: "var(--color-on-dark)",
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
          }}
          title="Revenir en bas"
        >
          <ArrowDown size={14} strokeWidth={1.8} />
        </button>
      )}

      <div
        style={{
          borderTop: "1px solid rgba(255,255,255,0.05)",
          padding: "14px 18px 18px",
        }}
      >
        <div
          style={{
            position: "relative",
            maxWidth: 920,
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: 10,
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.025))",
            boxShadow: "0 12px 34px rgba(0,0,0,0.22)",
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              void handleFileSelection(e.currentTarget.files);
              e.currentTarget.value = "";
            }}
          />

          <button
            type="button"
            onClick={openAttachmentPicker}
            title="Joindre un fichier"
            style={{
              width: 36,
              height: 36,
              borderRadius: 999,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.06)",
              cursor: "pointer",
              color: "var(--color-on-dark-soft)",
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
              transition: "background var(--duration-fast), color var(--duration-fast), border-color var(--duration-fast)",
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLElement;
              el.style.background = "rgba(255,255,255,0.07)";
              el.style.color = "var(--color-on-dark)";
              el.style.borderColor = "rgba(255,255,255,0.12)";
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLElement;
              el.style.background = "rgba(255,255,255,0.04)";
              el.style.color = "var(--color-on-dark-soft)";
              el.style.borderColor = "rgba(255,255,255,0.06)";
            }}
          >
            <Paperclip size={15} strokeWidth={1.75} />
          </button>

          <div style={{ flex: 1, minWidth: 0 }}>
            {attachments.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {attachments.map((attachment) => (
                  <button
                    key={attachment.id}
                    type="button"
                    onClick={() => removeAttachment(attachment.id)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      border: "1px solid rgba(255,255,255,0.06)",
                      borderRadius: 999,
                      padding: "5px 10px",
                      background: "rgba(255,255,255,0.04)",
                      color: "var(--color-on-dark-soft)",
                      cursor: "pointer",
                      fontSize: 11,
                      lineHeight: 1.2,
                    }}
                    title="Retirer le fichier"
                  >
                    <span style={{ maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {attachment.name}
                    </span>
                    <X size={11} strokeWidth={2} />
                  </button>
                ))}
              </div>
            )}

            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={composerPlaceholder}
              disabled={streaming}
              rows={1}
              style={{
                width: "100%",
                minHeight: 38,
                maxHeight: 168,
                background: "transparent",
                border: "none",
                padding: "4px 2px",
                fontSize: 13,
                fontFamily: "var(--font-sans)",
                color: "var(--color-on-dark)",
                resize: "none",
                outline: "none",
                overflowY: "auto",
                lineHeight: 1.45,
                caretColor: "var(--color-primary)",
              }}
              onFocus={() => {
                setStickToBottom(true);
                setShowJumpButton(false);
              }}
            />
          </div>

          <button
            type="button"
            onClick={() => {
              if (streaming) {
                void stopStreaming(true);
              } else {
                void send();
              }
            }}
            disabled={!streaming && !input.trim()}
            title={streaming ? "Stop" : "Envoyer"}
            style={{
              width: 40,
              height: 40,
              borderRadius: 999,
              background:
                !streaming && !input.trim()
                  ? "rgba(204,120,92,0.2)"
                  : streaming
                    ? "rgba(255,255,255,0.08)"
                    : "linear-gradient(180deg, var(--color-primary), var(--color-primary-active))",
              border: "1px solid rgba(255,255,255,0.06)",
              cursor: !streaming && !input.trim() ? "default" : "pointer",
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
              boxShadow: !streaming && !input.trim() ? "none" : "0 8px 20px rgba(204,120,92,0.16)",
              transition: "transform var(--duration-fast), background var(--duration-fast), box-shadow var(--duration-fast)",
            }}
            onMouseEnter={(e) => {
              if (!streaming && !input.trim()) return;
              (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
            }}
          >
            {streaming ? (
              <Square size={14} strokeWidth={2.2} color="#fff" />
            ) : (
              <ArrowUp size={15} strokeWidth={2.2} color="#fff" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
