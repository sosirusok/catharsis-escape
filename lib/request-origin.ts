export const PUBLIC_PAGES_ORIGIN = "https://sosirusok.github.io";
export const ADMIN_PAGES_ORIGIN = "https://sosirusok.github.io";

export function requestOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

export function isPublicWebOriginAllowed(request: Request): boolean {
  const raw = request.headers.get("origin");
  if (raw === null) return true;
  if (raw.trim().toLowerCase() === "null") return false;
  const origin = requestOrigin(request);
  if (!origin) return false;
  return origin === new URL(request.url).origin || origin === PUBLIC_PAGES_ORIGIN;
}

export function isAdminPagesOrigin(request: Request): boolean {
  return requestOrigin(request) === ADMIN_PAGES_ORIGIN;
}

export function isSameWebOrigin(request: Request): boolean {
  const origin = requestOrigin(request);
  return Boolean(origin && origin === new URL(request.url).origin);
}
