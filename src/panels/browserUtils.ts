import { DEFAULT_BROWSER_URL } from "../stores/panelStore";

const SEARCH_URL = "https://duckduckgo.com/?q=";
const COMPACT_URL_MAX_LENGTH = 52;

export function normalizeBrowserInput(raw: string): string {
  const value = raw.trim();
  if (!value) return DEFAULT_BROWSER_URL;

  if (/^https?:\/\//i.test(value)) {
    try {
      return new URL(value).toString();
    } catch {
      return `${SEARCH_URL}${encodeURIComponent(value)}`;
    }
  }

  if (/^(localhost|\d{1,3}(?:\.\d{1,3}){3})(:\d+)?(\/.*)?$/i.test(value)) {
    return `http://${value}`;
  }

  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/.*)?$/i.test(value)) {
    return `https://${value}`;
  }

  return `${SEARCH_URL}${encodeURIComponent(value)}`;
}

function trimCompact(value: string, maxLength = COMPACT_URL_MAX_LENGTH): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

export function formatCompactBrowserUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./i, "");
    const path = url.pathname.replace(/\/$/, "");
    const compact = `${host}${path === "/" ? "" : path}` || host;
    return trimCompact(compact || raw);
  } catch {
    return trimCompact(raw.trim() || DEFAULT_BROWSER_URL);
  }
}
