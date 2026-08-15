import { runtimeEnv } from "@/lib/booking";

const TOSS_API = "https://api.tosspayments.com/v1";

export type TossPayment = {
  paymentKey: string;
  orderId: string;
  status: string;
  method?: string;
  totalAmount: number;
  balanceAmount?: number;
  approvedAt?: string;
  receipt?: { url?: string } | null;
  cancels?: Array<{ cancelAmount?: number; canceledAt?: string; cancelStatus?: string }> | null;
};

export class TossApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "TossApiError";
    this.status = status;
    this.code = code;
  }
}

export function tossConfig() {
  const { TOSS_CLIENT_KEY: clientKey, TOSS_SECRET_KEY: secretKey } = runtimeEnv();
  if (!clientKey || !secretKey) throw new Error("TOSS_PAYMENT_UNAVAILABLE");
  const clientMode = clientKey.startsWith("test_") ? "test" : clientKey.startsWith("live_") ? "live" : "unknown";
  const secretMode = secretKey.startsWith("test_") ? "test" : secretKey.startsWith("live_") ? "live" : "unknown";
  if (clientMode === "unknown" || clientMode !== secretMode) throw new Error("TOSS_PAYMENT_KEY_MISMATCH");
  return { clientKey, secretKey, mode: clientMode as "test" | "live" };
}

async function tossRequest(path: string, options: { method?: "GET" | "POST"; body?: unknown; idempotencyKey?: string } = {}) {
  const { secretKey } = tossConfig();
  const headers = new Headers({ Authorization: `Basic ${btoa(`${secretKey}:`)}` });
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);
  const response = await fetch(`${TOSS_API}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(8_000),
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new TossApiError(response.status, String(data.code || "TOSS_API_ERROR"), String(data.message || "결제를 처리하지 못했습니다."));
  }
  return data as TossPayment;
}

export function confirmTossPayment(paymentKey: string, orderId: string, amount: number, idempotencyKey: string) {
  return tossRequest("/payments/confirm", {
    method: "POST",
    body: { paymentKey, orderId, amount },
    idempotencyKey,
  });
}

export function getTossPayment(orderId: string) {
  return tossRequest(`/payments/orders/${encodeURIComponent(orderId)}`);
}

export function cancelTossPayment(paymentKey: string, cancelReason: string, idempotencyKey: string) {
  return tossRequest(`/payments/${encodeURIComponent(paymentKey)}/cancel`, {
    method: "POST",
    body: { cancelReason },
    idempotencyKey,
  });
}
