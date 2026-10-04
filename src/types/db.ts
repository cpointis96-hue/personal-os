export interface XProfile {
  id: number;
  handle: string;
  display_name: string | null;
  added_at: number | null;
}

export interface XList {
  id: number;
  name: string;
  description: string | null;
  created_at: number | null;
}

export interface XListMember {
  id: number;
  list_id: number;
  profile_id: number;
  added_at: number | null;
}

export interface XTweet {
  id: number;
  tweet_id: string;
  profile_id: number | null;
  text: string | null;
  author_handle: string | null;
  created_at: number | null;
  scraped_at: number | null;
  media_json: string | null;
  raw_json: string | null;
}

export interface Chat {
  id: number;
  title: string | null;
  context_type: "free" | "fact_check" | null;
  created_at: number | null;
  updated_at: number | null;
}

export interface ChatMessage {
  id: number;
  chat_id: number;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: number | null;
}

export interface Setting {
  key: string;
  value: string;
}

export interface Job {
  id: number;
  url: string;
  mode: string | null;
  preset: string;
  status: "queued" | "running" | "done" | "error";
  progress: number;
  meta: string;
  created_at: number | null;
  updated_at: number | null;
}

export interface HistoryEntry {
  id: number;
  url: string | null;
  title: string | null;
  channel: string | null;
  mode: string | null;
  file_path: string | null;
  phash: string | null;
  downloaded_at: number | null;
}

export interface Preset {
  id: number;
  domain: string;
  config: string;
}
