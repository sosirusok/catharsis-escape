import { getAdmin } from "@/lib/admin";
import { json } from "@/lib/booking";
import { isAdminPagesOrigin, isSameWebOrigin } from "@/lib/request-origin";

export const ADMIN_REQUEST_HEADER = "x-catharsis-admin-request";

export function validAdminMutationRequest(request: Request): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return true;
  const sameOrigin = isSameWebOrigin(request);
  const pagesOrigin = isAdminPagesOrigin(request);
  if (!sameOrigin && !pagesOrigin) return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site" && !pagesOrigin) return false;
  if (fetchSite && !["same-origin", "cross-site", "none"].includes(fetchSite)) return false;
  return request.headers.get(ADMIN_REQUEST_HEADER) === "1";
}

export async function requireAdminApi(request?: Request) {
  if (request && !validAdminMutationRequest(request)) {
    return {
      response: json({ ok: false, error: { code: "INVALID_ORIGIN", message: "요청을 확인할 수 없습니다." } }, 403),
      admin: null,
    };
  }
  const admin = request ? await getAdmin(request) : null;
  if (!admin) {
    return {
      response: json({ ok: false, error: { code: "ADMIN_ACCESS_REQUIRED", message: "관리자 키를 다시 확인해 주세요." } }, 401),
      admin: null,
    };
  }
  return { response: null, admin };
}

export async function audit(
  db: D1Database,
  adminEmail: string,
  action: string,
  entityType: string,
  entityId: string,
  before: unknown,
  after: unknown,
) {
  await db.prepare("INSERT INTO admin_audit_logs (admin_email, action, entity_type, entity_id, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(adminEmail, action, entityType, entityId, JSON.stringify(before ?? {}), JSON.stringify(after ?? {})).run();
}
