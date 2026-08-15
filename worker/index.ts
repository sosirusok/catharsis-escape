/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  BUCKET?: R2Bucket;
  ADMIN_ACCESS_KEY?: string;
  ADMIN_SESSION_SECRET?: string;
  BOOKING_DATA_KEY?: string;
  BOOKING_LOOKUP_PEPPER?: string;
  TOSS_CLIENT_KEY?: string;
  TOSS_SECRET_KEY?: string;
  ALLOW_PUBLIC_TEST_PAYMENTS?: string;
  PUBLIC_SITE_URL?: string;
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_CLIENT_EMAIL?: string;
  FIREBASE_PRIVATE_KEY?: string;
  FIREBASE_PRIVATE_KEY_ID?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const GITHUB_PAGES_ORIGIN = "https://sosirusok.github.io";

function apiCorsProfile(pathname: string) {
  if (pathname.startsWith("/api/public/")) {
    return { methods: "GET, POST, OPTIONS", headers: "Content-Type" };
  }
  if (pathname.startsWith("/api/admin/")) {
    return {
      methods: "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      headers: "Authorization, Content-Type, X-Catharsis-Admin-Request",
    };
  }
  return null;
}

function corsHeaders(profile: { methods: string; headers: string }) {
  return {
    "Access-Control-Allow-Origin": GITHUB_PAGES_ORIGIN,
    "Access-Control-Allow-Methods": profile.methods,
    "Access-Control-Allow-Headers": profile.headers,
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function withApiCors(response: Response, profile: { methods: string; headers: string }) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders(profile))) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    (globalThis as typeof globalThis & { __SITES_ENV__?: Env }).__SITES_ENV__ = env;
    const url = new URL(request.url);
    const corsProfile = apiCorsProfile(url.pathname);
    const requestOrigin = request.headers.get("origin");

    if (request.method === "OPTIONS" && corsProfile) {
      if (requestOrigin !== GITHUB_PAGES_ORIGIN) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, { status: 204, headers: corsHeaders(corsProfile) });
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    const response = await handler.fetch(request, env, ctx);
    if (request.method === "GET" && url.pathname === "/api/public/availability") {
      ctx.waitUntil(import("@/lib/payment-flow").then(({ reconcileStalePayments }) => reconcileStalePayments(Date.now(), 1)).catch(() => undefined));
    }
    if (url.pathname.startsWith("/api/")) {
      ctx.waitUntil(import("@/lib/owner-push").then(({ dispatchOwnerPushes }) => dispatchOwnerPushes(10)).catch(() => undefined));
    }
    if (corsProfile && requestOrigin === GITHUB_PAGES_ORIGIN) {
      return withApiCors(response, corsProfile);
    }
    return response;
  },
  async scheduled(_controller: unknown, env: Env, ctx: ExecutionContext): Promise<void> {
    (globalThis as typeof globalThis & { __SITES_ENV__?: Env }).__SITES_ENV__ = env;
    ctx.waitUntil(import("@/lib/owner-push").then(({ dispatchOwnerPushes }) => dispatchOwnerPushes(25)).catch(() => undefined));
    ctx.waitUntil(import("@/lib/payment-flow").then(({ cleanupRetainedData, reconcileRecentProviderPayments, reconcileStalePayments }) =>
      Promise.allSettled([
        reconcileStalePayments(Date.now(), 3),
        reconcileRecentProviderPayments(Date.now(), 10),
        cleanupRetainedData(Date.now(), 25),
      ]),
    ).then(() => undefined).catch(() => undefined));
  },
};

export default worker;
