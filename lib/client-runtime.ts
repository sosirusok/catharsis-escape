const apiOrigin = typeof __CATHARSIS_API_ORIGIN__ === "string"
  ? __CATHARSIS_API_ORIGIN__.replace(/\/$/, "")
  : "";

const publicSite = typeof __CATHARSIS_PUBLIC_SITE_URL__ === "string"
  ? __CATHARSIS_PUBLIC_SITE_URL__
  : "/";

const adminSite = typeof __CATHARSIS_ADMIN_SITE_URL__ === "string"
  ? __CATHARSIS_ADMIN_SITE_URL__
  : "/admin";

let inMemoryAdminToken = "";

declare const __CATHARSIS_API_ORIGIN__: string | undefined;
declare const __CATHARSIS_PUBLIC_SITE_URL__: string | undefined;
declare const __CATHARSIS_ADMIN_SITE_URL__: string | undefined;

export function apiUrl(path: string): string {
  if (!apiOrigin) return path;
  return `${apiOrigin}${path.startsWith("/") ? path : `/${path}`}`;
}

export function publicSiteUrl(): string {
  return publicSite;
}

export function adminSiteUrl(): string {
  return adminSite;
}

export function usesRemoteApi(): boolean {
  return Boolean(apiOrigin);
}

export function themeImageUrl(imageKey: string): string {
  return apiUrl(`/api/public/theme-image/${imageKey}`);
}

export function readAdminSessionToken(): string {
  if (typeof window === "undefined" || !usesRemoteApi()) return "";
  return inMemoryAdminToken;
}

export function saveAdminSessionToken(token: string): void {
  if (typeof window === "undefined" || !usesRemoteApi()) return;
  inMemoryAdminToken = token;
}

export function clearAdminSessionToken(): void {
  if (typeof window === "undefined") return;
  inMemoryAdminToken = "";
}

export function adminRequestHeaders(initial?: HeadersInit): Headers {
  const headers = new Headers(initial);
  const token = readAdminSessionToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

export function notifyAdminSessionExpired(): void {
  clearAdminSessionToken();
  if (usesRemoteApi()) {
    window.dispatchEvent(new Event("catharsis-admin-session-expired"));
  } else {
    window.location.replace("/admin");
  }
}
