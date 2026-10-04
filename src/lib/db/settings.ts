import { query, run } from "./index";
import type { Setting } from "../../types/db";

export const settings = {
  get: async <T>(key: string): Promise<T | null> => {
    const rows = await query<Setting>("SELECT value FROM settings WHERE key = ?", [key]);
    if (rows.length === 0) return null;
    return JSON.parse(rows[0].value) as T;
  },
  set: async (key: string, value: unknown): Promise<void> => {
    await run(
      "INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, JSON.stringify(value)]
    );
  },
  delete: (key: string) => run("DELETE FROM settings WHERE key = ?", [key]),
};
