import { query, run } from "./index";
import type { XList, XProfile, XTweet } from "../../types/db";

export const lists = {
  getAll: () => query<XList>("SELECT * FROM x_lists ORDER BY created_at DESC"),
  insert: (name: string, description: string | null = null) =>
    run("INSERT INTO x_lists(name, description, created_at) VALUES (?, ?, ?)", [name, description, Date.now() / 1000]),
  delete: (id: number) => run("DELETE FROM x_lists WHERE id = ?", [id]),
  addMember: (listId: number, profileId: number) =>
    run("INSERT OR IGNORE INTO x_list_members(list_id, profile_id, added_at) VALUES (?, ?, ?)", [listId, profileId, Date.now() / 1000]),
  removeMember: (listId: number, profileId: number) =>
    run("DELETE FROM x_list_members WHERE list_id = ? AND profile_id = ?", [listId, profileId]),
  getMembers: (listId: number) =>
    query<XProfile>(
      `SELECT p.* FROM x_profiles p
       JOIN x_list_members m ON m.profile_id = p.id
       WHERE m.list_id = ?`,
      [listId]
    ),
  getXFeed: (listId: number, limit = 50, offset = 0) =>
    query<XTweet>(
      `SELECT t.* FROM x_tweets t
       JOIN x_list_members m ON m.profile_id = t.profile_id
       WHERE m.list_id = ?
       ORDER BY t.created_at DESC
       LIMIT ? OFFSET ?`,
      [listId, limit, offset]
    ),
};
