import { requireAdminApi } from "@/lib/admin-api";
import { createId, getBucket, json, sameOrigin } from "@/lib/booking";

export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_FILE_BYTES + 128 * 1024;

function detectedImage(bytes: Uint8Array): { contentType: string; extension: string } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: "image/jpeg", extension: "jpg" };
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return { contentType: "image/png", extension: "png" };
  }
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return { contentType: "image/webp", extension: "webp" };
  }
  return null;
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, error: { message: "요청을 확인할 수 없습니다." } }, 403);
  const auth = await requireAdminApi(request);
  if (auth.response) return auth.response;
  try {
    const contentLength = request.headers.get("content-length");
    if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_MULTIPART_BYTES)) {
      return json({ ok: false, error: { code: "IMAGE_TOO_LARGE", message: "이미지는 5MB 이하만 업로드할 수 있습니다." } }, 413);
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json({ ok: false, error: { message: "이미지를 선택해 주세요." } }, 400);
    if (file.size > MAX_FILE_BYTES) return json({ ok: false, error: { code: "IMAGE_TOO_LARGE", message: "이미지는 5MB 이하만 업로드할 수 있습니다." } }, 413);
    const signature = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const detected = detectedImage(signature);
    if (!detected || detected.contentType !== file.type.toLowerCase()) {
      return json({ ok: false, error: { code: "INVALID_IMAGE", message: "파일 내용이 올바른 JPG, PNG 또는 WebP 이미지인지 확인해 주세요." } }, 400);
    }
    const key = `themes/${createId("image")}.${detected.extension}`;
    await getBucket().put(key, file.stream(), { httpMetadata: { contentType: detected.contentType, cacheControl: "public, max-age=31536000, immutable" } });
    return json({ ok: true, key }, 201);
  } catch {
    return json({ ok: false, error: { message: "이미지를 업로드하지 못했습니다." } }, 500);
  }
}
