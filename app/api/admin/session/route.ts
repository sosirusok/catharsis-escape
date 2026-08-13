import {
  adminAccessKeyMatches,
  adminSessionCookie,
  clearAdminSessionCookie,
  createAdminSession,
} from "@/lib/admin";
import { validAdminMutationRequest } from "@/lib/admin-api";
import { enforceRateLimit, json } from "@/lib/booking";
import { isAdminPagesOrigin } from "@/lib/request-origin";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 512;

export async function POST(request: Request) {
  if (!validAdminMutationRequest(request)) {
    return json({ ok: false, error: { code: "INVALID_ORIGIN", message: "요청을 확인할 수 없습니다." } }, 403);
  }

  try {
    const contentLength = request.headers.get("content-length");
    if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) {
      return json({ ok: false, error: { code: "INVALID_REQUEST", message: "관리자 키를 확인해 주세요." } }, 400);
    }
    if (!(await enforceRateLimit(request, "admin-access", 8, 15 * 60))) {
      return json({ ok: false, error: { code: "TOO_MANY_ATTEMPTS", message: "잠시 후 다시 시도해 주세요." } }, 429);
    }

    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return json({ ok: false, error: { code: "INVALID_REQUEST", message: "관리자 키를 확인해 주세요." } }, 400);
    }
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return json({ ok: false, error: { code: "INVALID_REQUEST", message: "관리자 키를 확인해 주세요." } }, 400);
    }
    const accessKey = typeof body === "object" && body !== null && "accessKey" in body
      ? String((body as { accessKey?: unknown }).accessKey ?? "")
      : "";
    if (!accessKey || accessKey.length > 128 || !(await adminAccessKeyMatches(accessKey))) {
      return json({ ok: false, error: { code: "INVALID_ACCESS_KEY", message: "관리자 키를 확인해 주세요." } }, 401);
    }

    const pagesRequest = isAdminPagesOrigin(request);
    const sessionToken = await createAdminSession(pagesRequest ? "github-pages" : "site");
    const response = json(pagesRequest
      ? { ok: true, sessionToken, expiresIn: 12 * 60 * 60 }
      : { ok: true });
    if (!pagesRequest) {
      response.headers.append("Set-Cookie", adminSessionCookie(sessionToken));
    }
    return response;
  } catch {
    return json({ ok: false, error: { code: "SERVICE_ERROR", message: "관리 화면을 열지 못했습니다. 잠시 후 다시 시도해 주세요." } }, 500);
  }
}

export async function DELETE(request: Request) {
  if (!validAdminMutationRequest(request)) {
    return json({ ok: false, error: { code: "INVALID_ORIGIN", message: "요청을 확인할 수 없습니다." } }, 403);
  }
  const response = json({ ok: true });
  response.headers.append("Set-Cookie", clearAdminSessionCookie());
  return response;
}
