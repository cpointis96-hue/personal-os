import { query, run, runGetId } from "./index";
import type { Chat, ChatMessage } from "../../types/db";

export const chats = {
  getAll: () => query<Chat>("SELECT * FROM chats ORDER BY updated_at DESC"),
  getById: (id: number) => query<Chat>("SELECT * FROM chats WHERE id = ?", [id]),
  insert: (title: string, contextType: Chat["context_type"] = "free") =>
    runGetId("INSERT INTO chats(title, context_type, created_at, updated_at) VALUES (?, ?, ?, ?)",
      [title, contextType, Date.now() / 1000, Date.now() / 1000]),
  touch: (id: number) =>
    run("UPDATE chats SET updated_at = ? WHERE id = ?", [Date.now() / 1000, id]),
  update: (id: number, title: string) =>
    run("UPDATE chats SET title = ?, updated_at = ? WHERE id = ?", [title, Date.now() / 1000, id]),
  delete: (id: number) => run("DELETE FROM chats WHERE id = ?", [id]),
  getMessages: (chatId: number) =>
    query<ChatMessage>("SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY created_at ASC", [chatId]),
  addMessage: (chatId: number, role: ChatMessage["role"], content: string) =>
    run("INSERT INTO chat_messages(chat_id, role, content, created_at) VALUES (?, ?, ?, ?)",
      [chatId, role, content, Date.now() / 1000]),
};
