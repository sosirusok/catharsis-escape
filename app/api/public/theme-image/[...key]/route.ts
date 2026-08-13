import { getBucket } from "@/lib/booking";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ key: string[] }> }) {
  try {
    const { key: parts } = await context.params;
    const key = parts.join("/");
    if (!/^themes\/[a-zA-Z0-9._/-]{1,180}$/.test(key)) return new Response("Not found", { status: 404 });
    const object = await getBucket().get(key);
    if (!object) return new Response("Not found", { status: 404 });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(object.body, { headers });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
