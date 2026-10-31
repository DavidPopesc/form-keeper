// User settings, kept in chrome.storage.local so every context can read them.

export const DEFAULT_SETTINGS = {
  paused: false,
  // Hostnames to never record. Matches the host itself and its subdomains.
  excludedSites: [],
  // Most GET forms are searches/filters; skip them unless asked.
  captureGetForms: false,
  // Skip fields that look like passwords, card numbers, SSNs, tokens, etc.
  skipSensitive: true,
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...settings };
}

export async function updateSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export function normalizeHost(input) {
  let host = String(input).trim().toLowerCase();
  if (!host) return "";
  try {
    if (host.includes("/")) host = new URL(host.includes("://") ? host : `https://${host}`).hostname;
  } catch {
    return "";
  }
  return host.replace(/^www\./, "");
}

export function isExcluded(hostname, excludedSites) {
  const host = normalizeHost(hostname);
  return excludedSites.some((site) => host === site || host.endsWith(`.${site}`));
}
