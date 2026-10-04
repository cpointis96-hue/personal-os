import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { profiles } from "../../lib/db/profiles";
import { lists } from "../../lib/db/lists";
import { tweets } from "../../lib/db/tweets";
import { settings } from "../../lib/db/settings";
import type { XProfile, XList, XTweet } from "../../types/db";

const REFRESH_OPTIONS = [5, 15, 30, 60];

interface TweetEventPayload {
  tweet_id: string;
  profile_id: number | null;
  text: string | null;
  author_handle: string | null;
  created_at: number | null;
  scraped_at: number;
  media_json: string | null;
  raw_json: string;
}

function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3500);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        background: "var(--color-surface-dark-elevated)",
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 8,
        padding: "10px 16px",
        fontSize: 12,
        fontFamily: "var(--font-sans)",
        color: "var(--color-on-dark)",
        maxWidth: 320,
        zIndex: 9999,
        boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
        animation: "fadeInUp 0.2s ease",
      }}
    >
      {message}
    </div>
  );
}

function ListMembersModal({
  list,
  allProfiles,
  members,
  onToggle,
  onClose,
}: {
  list: XList;
  allProfiles: XProfile[];
  members: XProfile[];
  onToggle: (profileId: number, isMember: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const memberIds = new Set(members.map((p) => p.id));

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--color-surface-dark-elevated)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 10,
          padding: "20px",
          width: 320,
          maxHeight: 400,
          overflowY: "auto",
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--color-on-dark)",
            marginBottom: 16,
            fontFamily: "var(--font-sans)",
          }}
        >
          {list.name}
        </div>
        {allProfiles.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--color-on-dark-soft)", fontFamily: "var(--font-sans)" }}>
            Aucun compte
          </div>
        )}
        {allProfiles.map((p) => {
          const checked = memberIds.has(p.id);
          return (
            <label
              key={p.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "6px 0",
                cursor: "pointer",
                fontSize: 13,
                fontFamily: "var(--font-sans)",
                color: "var(--color-on-dark)",
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(p.id, checked)}
                style={{ accentColor: "var(--color-primary)" }}
              />
              @{p.handle}
            </label>
          );
        })}
        <button
          onClick={onClose}
          style={{
            marginTop: 16,
            width: "100%",
            padding: "8px",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 6,
            cursor: "pointer",
            color: "var(--color-on-dark-soft)",
            fontSize: 12,
            fontFamily: "var(--font-sans)",
          }}
        >
          Fermer
        </button>
      </div>
    </div>
  );
}

export function XSettings() {
  const [allProfiles, setAllProfiles] = useState<XProfile[]>([]);
  const [allLists, setAllLists] = useState<XList[]>([]);
  const [listMemberCounts, setListMemberCounts] = useState<Record<number, number>>({});

  const [handleInput, setHandleInput] = useState("");
  const [listNameInput, setListNameInput] = useState("");

  const [refreshMinutes, setRefreshMinutes] = useState(30);
  const [galleryDlPath, setGalleryDlPath] = useState<string | null>(null);
  const [pathOverride, setPathOverride] = useState("");

  const [toast, setToast] = useState<string | null>(null);
  const [editingList, setEditingList] = useState<{ list: XList; members: XProfile[] } | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
  }, []);

  const loadProfiles = useCallback(async () => {
    const data = await profiles.getAll();
    setAllProfiles(data);
  }, []);

  const loadLists = useCallback(async () => {
    const data = await lists.getAll();
    setAllLists(data);
    const counts: Record<number, number> = {};
    await Promise.all(
      data.map(async (l) => {
        const members = await lists.getMembers(l.id);
        counts[l.id] = members.length;
      })
    );
    setListMemberCounts(counts);
  }, []);

  useEffect(() => {
    loadProfiles();
    loadLists();

    settings.get<number>("x_refresh_minutes").then((val) => {
      if (val !== null) setRefreshMinutes(val);
    });

    settings.get<string>("x_gallery_dl_path").then((val) => {
      if (val) setPathOverride(val);
    });

    invoke<string>("x_get_gallery_dl_path")
      .then((path) => setGalleryDlPath(path))
      .catch(() => setGalleryDlPath(null));

    const unlisten = listen<TweetEventPayload>("x://tweet", async (event) => {
      const p = event.payload;
      const handle = p.author_handle ?? "";
      const profile = allProfiles.find((pr) => pr.handle === handle);
      const tweetRow: Omit<XTweet, "id"> = {
        tweet_id: p.tweet_id,
        profile_id: profile?.id ?? null,
        text: p.text,
        author_handle: p.author_handle,
        created_at: p.created_at,
        scraped_at: p.scraped_at,
        media_json: p.media_json,
        raw_json: p.raw_json,
      };
      await tweets.upsert(tweetRow);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  async function addProfile() {
    const handle = handleInput.trim().replace(/^@/, "").toLowerCase().replace(/\s+/g, "");
    if (!handle) return;
    try {
      await profiles.insert(handle, null);
      setHandleInput("");
      await loadProfiles();
    } catch (e) {
      showToast(`Erreur: ${e}`);
    }
  }

  async function deleteProfile(id: number) {
    await profiles.delete(id);
    await loadProfiles();
  }

  async function createList() {
    const name = listNameInput.trim();
    if (!name) return;
    await lists.insert(name);
    setListNameInput("");
    await loadLists();
  }

  async function deleteList(id: number) {
    if (!confirm("Supprimer cette liste ?")) return;
    await lists.delete(id);
    await loadLists();
  }

  async function openListEditor(list: XList) {
    const members = await lists.getMembers(list.id);
    setEditingList({ list, members });
  }

  async function toggleMember(profileId: number, isMember: boolean) {
    if (!editingList) return;
    const listId = editingList.list.id;
    if (isMember) {
      await lists.removeMember(listId, profileId);
    } else {
      await lists.addMember(listId, profileId);
    }
    const updated = await lists.getMembers(listId);
    setEditingList((prev) => (prev ? { ...prev, members: updated } : null));
    await loadLists();
  }

  async function testGalleryDl() {
    try {
      const result = await invoke<string>("x_test_gallery_dl");
      showToast(result);
    } catch (e) {
      showToast(`Erreur: ${e}`);
    }
  }

  async function saveRefresh(val: number) {
    setRefreshMinutes(val);
    await settings.set("x_refresh_minutes", val);
  }

  async function savePathOverride(val: string) {
    setPathOverride(val);
    await settings.set("x_gallery_dl_path", val);
  }

  const sectionLabel: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--color-on-dark-soft)",
    fontFamily: "var(--font-sans)",
    marginBottom: 10,
  };

  const card: React.CSSProperties = {
    background: "var(--color-surface-dark-soft)",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 8,
    padding: "12px",
    marginBottom: 16,
  };

  const row: React.CSSProperties = {
    display: "flex",
    gap: 8,
    marginBottom: 10,
  };

  const inputStyle: React.CSSProperties = {
    flex: 1,
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 6,
    padding: "6px 10px",
    fontSize: 12,
    color: "var(--color-on-dark)",
    fontFamily: "var(--font-sans)",
    outline: "none",
  };

  const btnPrimary: React.CSSProperties = {
    background: "var(--color-primary)",
    border: "none",
    borderRadius: 6,
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 600,
    color: "#fff",
    cursor: "pointer",
    fontFamily: "var(--font-sans)",
    flexShrink: 0,
  };

  const btnGhost: React.CSSProperties = {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "var(--color-on-dark-soft)",
    fontSize: 12,
    padding: "2px 6px",
    fontFamily: "var(--font-sans)",
  };

  const itemRow: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "5px 0",
    borderBottom: "1px solid rgba(255,255,255,0.04)",
  };

  const itemLabel: React.CSSProperties = {
    fontSize: 12,
    color: "var(--color-on-dark)",
    fontFamily: "var(--font-sans)",
  };

  return (
    <div style={{ paddingTop: 4 }}>
      {/* Bloc 1 — Comptes */}
      <div style={card}>
        <div style={sectionLabel}>Comptes ({allProfiles.length})</div>
        <div style={row}>
          <input
            style={inputStyle}
            placeholder="@handle"
            value={handleInput}
            onChange={(e) => setHandleInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addProfile()}
          />
          <button style={btnPrimary} onClick={addProfile}>
            Ajouter
          </button>
        </div>
        {allProfiles.map((p) => (
          <div key={p.id} style={itemRow}>
            <span style={itemLabel}>@{p.handle}</span>
            <button style={btnGhost} onClick={() => deleteProfile(p.id)} title="Supprimer">
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Bloc 2 — Listes */}
      <div style={card}>
        <div style={sectionLabel}>Listes</div>
        <div style={row}>
          <input
            style={inputStyle}
            placeholder="Nom de la liste"
            value={listNameInput}
            onChange={(e) => setListNameInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createList()}
          />
          <button style={btnPrimary} onClick={createList}>
            Créer
          </button>
        </div>
        {allLists.map((l) => (
          <div key={l.id} style={itemRow}>
            <span style={itemLabel}>
              {l.name}{" "}
              <span style={{ color: "var(--color-on-dark-soft)" }}>
                ({listMemberCounts[l.id] ?? 0} comptes)
              </span>
            </span>
            <div style={{ display: "flex", gap: 4 }}>
              <button style={btnGhost} onClick={() => openListEditor(l)} title="Membres">
                ⚙
              </button>
              <button style={btnGhost} onClick={() => deleteList(l.id)} title="Supprimer">
                ×
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Bloc 3 — Scraping */}
      <div style={card}>
        <div style={sectionLabel}>Scraping</div>

        <div style={{ marginBottom: 14 }}>
          <div
            style={{ fontSize: 12, color: "var(--color-on-dark-soft)", fontFamily: "var(--font-sans)", marginBottom: 6 }}
          >
            Actualisation toutes les{" "}
            <strong style={{ color: "var(--color-on-dark)" }}>{refreshMinutes} min</strong>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {REFRESH_OPTIONS.map((opt) => (
              <button
                key={opt}
                onClick={() => saveRefresh(opt)}
                style={{
                  padding: "4px 10px",
                  fontSize: 11,
                  fontFamily: "var(--font-sans)",
                  borderRadius: 5,
                  border: `1px solid ${refreshMinutes === opt ? "var(--color-primary)" : "rgba(255,255,255,0.08)"}`,
                  background: refreshMinutes === opt ? "rgba(204,120,92,0.15)" : "rgba(255,255,255,0.04)",
                  color: refreshMinutes === opt ? "var(--color-primary)" : "var(--color-on-dark-soft)",
                  cursor: "pointer",
                }}
              >
                {opt} min
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div
            style={{ fontSize: 12, color: "var(--color-on-dark-soft)", fontFamily: "var(--font-sans)", marginBottom: 6 }}
          >
            Chemin gallery-dl :{" "}
            <span style={{ color: galleryDlPath ? "#5db872" : "#e05a4a", fontFamily: "var(--font-mono, monospace)" }}>
              {galleryDlPath ?? "non trouvé"}
            </span>
          </div>
          <button
            onClick={testGalleryDl}
            style={{
              ...btnPrimary,
              background: "rgba(255,255,255,0.07)",
              color: "var(--color-on-dark)",
              border: "1px solid rgba(255,255,255,0.10)",
            }}
          >
            Tester gallery-dl
          </button>
        </div>

        <div>
          <div
            style={{ fontSize: 12, color: "var(--color-on-dark-soft)", fontFamily: "var(--font-sans)", marginBottom: 6 }}
          >
            Chemin personnalisé (optionnel)
          </div>
          <input
            style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
            placeholder="/opt/homebrew/bin/gallery-dl"
            value={pathOverride}
            onChange={(e) => savePathOverride(e.target.value)}
          />
        </div>
      </div>

      {editingList && (
        <ListMembersModal
          list={editingList.list}
          allProfiles={allProfiles}
          members={editingList.members}
          onToggle={toggleMember}
          onClose={() => setEditingList(null)}
        />
      )}

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
