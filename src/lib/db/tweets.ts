import { query, run } from "./index";
import type { XTweet } from "../../types/db";

export const tweets = {
  getByProfileId: (profileId: number, limit = 50, offset = 0) =>
    query<XTweet>(
      "SELECT * FROM x_tweets WHERE profile_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
      [profileId, limit, offset]
    ),
  upsert: (tweet: Omit<XTweet, "id">) =>
    run(
      `INSERT INTO x_tweets(tweet_id, profile_id, text, author_handle, created_at, scraped_at, media_json, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tweet_id) DO UPDATE SET
         text = excluded.text,
         media_json = excluded.media_json,
         raw_json = excluded.raw_json,
         scraped_at = excluded.scraped_at`,
      [tweet.tweet_id, tweet.profile_id, tweet.text, tweet.author_handle, tweet.created_at, tweet.scraped_at, tweet.media_json, tweet.raw_json]
    ),
  delete: (id: number) => run("DELETE FROM x_tweets WHERE id = ?", [id]),
};
