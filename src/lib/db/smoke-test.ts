import { profiles } from "./profiles";
import { lists } from "./lists";
import { tweets } from "./tweets";

async function smokeTest() {
  await profiles.insert("testuser", "Test User");
  const [profile] = await profiles.getByHandle("testuser");
  console.log("Profile inserted:", profile);

  await lists.insert("Test List", "A list for smoke testing");
  const [list] = await lists.getAll();
  console.log("List inserted:", list);

  await lists.addMember(list.id, profile.id);
  const members = await lists.getMembers(list.id);
  console.log("Members:", members);

  const now = Date.now() / 1000;
  await tweets.upsert({ tweet_id: "t1", profile_id: profile.id, text: "Hello world", author_handle: "testuser", created_at: now - 200, scraped_at: now, media_json: null, raw_json: null });
  await tweets.upsert({ tweet_id: "t2", profile_id: profile.id, text: "Second tweet", author_handle: "testuser", created_at: now - 100, scraped_at: now, media_json: null, raw_json: null });
  await tweets.upsert({ tweet_id: "t3", profile_id: profile.id, text: "Third tweet", author_handle: "testuser", created_at: now, scraped_at: now, media_json: null, raw_json: null });

  const feed = await lists.getXFeed(list.id, 50, 0);
  console.log("XFeed result:", JSON.stringify(feed, null, 2));
}

smokeTest().catch(console.error);
