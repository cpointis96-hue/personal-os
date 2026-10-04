import { query, run } from "./index";
import type { XProfile } from "../../types/db";

export const profiles = {
  getAll: () => query<XProfile>("SELECT * FROM x_profiles ORDER BY added_at DESC"),
  getById: (id: number) => query<XProfile>("SELECT * FROM x_profiles WHERE id = ?", [id]),
  getByHandle: (handle: string) => query<XProfile>("SELECT * FROM x_profiles WHERE handle = ?", [handle]),
  insert: (handle: string, displayName: string | null = null) =>
    run("INSERT INTO x_profiles(handle, display_name, added_at) VALUES (?, ?, ?)", [handle, displayName, Date.now() / 1000]),
  update: (id: number, displayName: string) =>
    run("UPDATE x_profiles SET display_name = ? WHERE id = ?", [displayName, id]),
  delete: (id: number) => run("DELETE FROM x_profiles WHERE id = ?", [id]),
};
