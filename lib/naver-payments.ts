import { runtimeEnv } from "@/lib/booking";

const NAVER_PAY_PATH = "/naverpay-partner/naverpay/payments";

export type NaverPayMode = "development" | "production";

export type NaverPayment = {
  paymentKey: string;
  orderId: string;
  status: "DONE" | "CANCELED" | "PARTIAL_CANCELED" | "ABORTED";
  method: string;
  totalAmount: number;
  taxScopeAmount: number;
  taxExScopeAmount: number;
  balanceAmount: number;
  approvedAt?: string;
  receipt?: null;
  cancels: Array<{ cancelAmount: number; taxScopeAmount: number; taxExScopeAmount: number; canceledAt?: string }>;
};

type NaverPayResponse<T> = {
  code?: unknown;
  message?: unknown;
  body?: T;
};

type ApprovalDetail = {
  paymentId?: unknown;
  merchantPayKey?: unknown;
  admissionState?: unknown;
  admissionTypeCode?: unknown;
  admissionYmdt?: unknown;
  totalPayAmount?: unknown;
  taxScopeAmount?: unknown;
  taxExScopeAmount?: unknown;
  primaryPayMeans?: unknown;
  npointPayAmount?: unknown;
};

type ApprovalBody = {
  paymentId?: unknown;
  detail?: ApprovalDetail;
};

type HistoryItem = ApprovalDetail & {
  admissionTypeCode?: unknown;
};

type HistoryBody = {
  list?: unknown;
  totalPageCount?: unknown;
};

type CancelBody = {
  paymentId?: unknown;
  primaryPayMeans?: unknown;
  primaryPayCancelAmount?: unknown;
  npointCancelAmount?: unknown;
  giftCardCancelAmount?: unknown;
  discountCancelAmount?: unknown;
  taxScopeAmount?: unknown;
  taxExScopeAmount?: unknown;
  totalRestAmount?: unknown;
  cancelYmdt?: unknown;
};

export class NaverPayApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "NaverPayApiError";
    this.status = status;
    this.code = code;
  }
}

export function naverPayConfig() {
  const {
    NAVER_PAY_CLIENT_ID: clientId,
    NAVER_PAY_CLIENT_SECRET: clientSecret,
    NAVER_PAY_CHAIN_ID: chainId,
    NAVER_PAY_MODE: configuredMode,
  } = runtimeEnv();
  if (!clientId || !clientSecret || !chainId) throw new Error("NAVER_PAY_UNAVAILABLE");
  if (configuredMode !== "development" && configuredMode !== "production") {
    throw new Error("NAVER_PAY_MODE_INVALID");
  }
  return {
    clientId,
    clientSecret,
    chainId,
    mode: configuredMode as NaverPayMode,
    apiOrigin: configuredMode === "production" ? "https://pay.paygate.naver.com" : "https://dev-pay.paygate.naver.com",
  };
}

export function activeNaverPayConfig() {
  if (runtimeEnv().PAYMENT_PROVIDER !== "naverpay") throw new Error("NAVER_PAY_NOT_ACTIVE");
  const taxScope = runtimeEnv().NAVER_PAY_TAX_SCOPE;
  if (taxScope !== "taxable" && taxScope !== "tax_exempt") throw new Error("NAVER_PAY_TAX_SCOPE_INVALID");
  return { ...naverPayConfig(), taxScope: taxScope as "taxable" | "tax_exempt" };
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function amountValue(value: unknown) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : 0;
}

function utf8Limit(value: string, maxBytes: number) {
  let result = "";
  for (const character of value) {
    if (new TextEncoder().encode(result + character).byteLength > maxBytes) break;
    result += character;
  }
  return result;
}

function naverDate(value: unknown): string | undefined {
  const text = stringValue(value);
  if (!/^\d{14}$/.test(text)) return undefined;
  const normalized = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T${text.slice(8, 10)}:${text.slice(10, 12)}:${text.slice(12, 14)}+09:00`;
  return Number.isFinite(Date.parse(normalized)) ? normalized : undefined;
}

function methodLabel(primaryPayMeans: unknown, pointAmount: unknown) {
  if (primaryPayMeans === "CARD") return "네이버페이 카드";
  if (primaryPayMeans === "BANK") return "네이버페이 계좌";
  return amountValue(pointAmount) > 0 ? "네이버페이 포인트·머니" : "네이버페이";
}

function apiHeaders(idempotencyKey?: string, contentType?: string) {
  const { clientId, clientSecret, chainId } = naverPayConfig();
  const headers = new Headers({
    "X-Naver-Client-Id": clientId,
    "X-Naver-Client-Secret": clientSecret,
    "X-NaverPay-Chain-Id": chainId,
  });
  if (idempotencyKey) headers.set("X-NaverPay-Idempotency-Key", idempotencyKey.slice(0, 64));
  if (contentType) headers.set("Content-Type", contentType);
  return headers;
}

async function naverRequest<T>(
  path: string,
  options: { body?: BodyInit; contentType?: string; idempotencyKey?: string; timeoutMs?: number } = {},
) {
  const { apiOrigin } = naverPayConfig();
  let response: Response;
  try {
    response = await fetch(`${apiOrigin}${NAVER_PAY_PATH}${path}`, {
      method: "POST",
      headers: apiHeaders(options.idempotencyKey, options.contentType),
      body: options.body,
      signal: AbortSignal.timeout(options.timeoutMs || 10_000),
    });
  } catch {
    throw new NaverPayApiError(503, "NAVER_PAY_NETWORK_ERROR", "네이버페이 처리 결과를 확인하고 있습니다.");
  }
  let data: NaverPayResponse<T>;
  try {
    data = await response.json() as NaverPayResponse<T>;
  } catch {
    throw new NaverPayApiError(response.status || 503, "NAVER_PAY_INVALID_RESPONSE", "네이버페이 처리 결과를 확인하고 있습니다.");
  }
  const code = stringValue(data.code) || "NAVER_PAY_API_ERROR";
  const message = stringValue(data.message) || "네이버페이 결제를 처리하지 못했습니다.";
  if (code !== "Success") throw new NaverPayApiError(response.status || 409, code, message);
  if (!response.ok && response.status !== 409) throw new NaverPayApiError(response.status, code, message);
  return data.body as T;
}

function approvalPayment(body: ApprovalBody): NaverPayment {
  const detail = body?.detail || {};
  const bodyPaymentId = stringValue(body?.paymentId);
  const detailPaymentId = stringValue(detail.paymentId);
  const paymentId = detailPaymentId || bodyPaymentId;
  const orderId = stringValue(detail.merchantPayKey);
  const totalAmount = amountValue(detail.totalPayAmount);
  if (
    !paymentId ||
    !bodyPaymentId ||
    !detailPaymentId ||
    bodyPaymentId !== detailPaymentId ||
    !orderId ||
    !totalAmount ||
    detail.admissionTypeCode !== "01" ||
    detail.admissionState !== "SUCCESS"
  ) {
    throw new NaverPayApiError(409, "NAVER_PAY_INVALID_APPROVAL", "네이버페이 승인 정보를 확인할 수 없습니다.");
  }
  if (amountValue(detail.taxScopeAmount) + amountValue(detail.taxExScopeAmount) !== totalAmount) {
    throw new NaverPayApiError(409, "NAVER_PAY_TAX_MISMATCH", "네이버페이 결제 금액을 확인할 수 없습니다.");
  }
  return {
    paymentKey: paymentId,
    orderId,
    status: "DONE",
    method: methodLabel(detail.primaryPayMeans, detail.npointPayAmount),
    totalAmount,
    taxScopeAmount: amountValue(detail.taxScopeAmount),
    taxExScopeAmount: amountValue(detail.taxExScopeAmount),
    balanceAmount: totalAmount,
    approvedAt: naverDate(detail.admissionYmdt),
    receipt: null,
    cancels: [],
  };
}

function historyPayment(paymentId: string, body: HistoryBody): NaverPayment {
  const items = Array.isArray(body?.list) ? body.list as HistoryItem[] : [];
  const approval = items.find((item) => item.admissionTypeCode === "01" && item.admissionState === "SUCCESS");
  if (!approval) {
    const failed = items.find((item) => item.admissionTypeCode === "01");
    if (failed) {
      if (stringValue(failed.paymentId) !== paymentId || !stringValue(failed.merchantPayKey)) {
        throw new NaverPayApiError(409, "NAVER_PAY_INVALID_RESPONSE", "네이버페이 결제 내역을 확인할 수 없습니다.");
      }
      return {
        paymentKey: paymentId,
        orderId: stringValue(failed.merchantPayKey),
        status: "ABORTED",
        method: methodLabel(failed.primaryPayMeans, failed.npointPayAmount),
        totalAmount: amountValue(failed.totalPayAmount),
        taxScopeAmount: amountValue(failed.taxScopeAmount),
        taxExScopeAmount: amountValue(failed.taxExScopeAmount),
        balanceAmount: 0,
        approvedAt: naverDate(failed.admissionYmdt),
        receipt: null,
        cancels: [],
      };
    }
    throw new NaverPayApiError(404, "NAVER_PAY_HISTORY_NOT_FOUND", "네이버페이 결제 내역을 찾을 수 없습니다.");
  }
  const totalAmount = amountValue(approval.totalPayAmount);
  const orderId = stringValue(approval.merchantPayKey);
  if (
    stringValue(approval.paymentId) !== paymentId ||
    !orderId ||
    !totalAmount ||
    amountValue(approval.taxScopeAmount) + amountValue(approval.taxExScopeAmount) !== totalAmount
  ) {
    throw new NaverPayApiError(409, "NAVER_PAY_INVALID_RESPONSE", "네이버페이 결제 내역을 확인할 수 없습니다.");
  }
  const cancellationItems = items.filter((item) => ["03", "04"].includes(stringValue(item.admissionTypeCode)) && item.admissionState === "SUCCESS");
  if (cancellationItems.some((item) => (
    stringValue(item.paymentId) !== paymentId ||
    stringValue(item.merchantPayKey) !== orderId ||
    amountValue(item.totalPayAmount) <= 0 ||
    amountValue(item.taxScopeAmount) + amountValue(item.taxExScopeAmount) !== amountValue(item.totalPayAmount)
  ))) {
    throw new NaverPayApiError(409, "NAVER_PAY_INVALID_RESPONSE", "네이버페이 취소 내역을 확인할 수 없습니다.");
  }
  const cancels = cancellationItems.map((item) => ({
    cancelAmount: amountValue(item.totalPayAmount),
    taxScopeAmount: amountValue(item.taxScopeAmount),
    taxExScopeAmount: amountValue(item.taxExScopeAmount),
    canceledAt: naverDate(item.admissionYmdt),
  }));
  const canceledTotal = cancels.reduce((sum, cancel) => sum + cancel.cancelAmount, 0);
  if (canceledTotal > totalAmount) {
    throw new NaverPayApiError(409, "NAVER_PAY_CANCEL_MISMATCH", "네이버페이 취소 금액을 확인할 수 없습니다.");
  }
  const balanceAmount = Math.max(0, totalAmount - canceledTotal);
  return {
    paymentKey: paymentId,
    orderId,
    status: balanceAmount === 0 && canceledTotal === totalAmount ? "CANCELED" : canceledTotal > 0 ? "PARTIAL_CANCELED" : "DONE",
    method: methodLabel(approval.primaryPayMeans, approval.npointPayAmount),
    totalAmount,
    taxScopeAmount: amountValue(approval.taxScopeAmount),
    taxExScopeAmount: amountValue(approval.taxExScopeAmount),
    balanceAmount,
    approvedAt: naverDate(approval.admissionYmdt),
    receipt: null,
    cancels,
  };
}

export async function confirmNaverPayment(paymentId: string, idempotencyKey: string) {
  const body = new URLSearchParams({ paymentId });
  try {
    const response = await naverRequest<ApprovalBody>("/v2.2/apply/payment", {
      body,
      contentType: "application/x-www-form-urlencoded",
      idempotencyKey,
      timeoutMs: 60_000,
    });
    return approvalPayment(response);
  } catch (error) {
    if (error instanceof NaverPayApiError && error.code === "AlreadyComplete") return getNaverPayment(paymentId);
    throw error;
  }
}

export async function getNaverPayment(paymentId: string) {
  const body = JSON.stringify({ pageNumber: 1, rowsPerPage: 100 });
  const response = await naverRequest<HistoryBody>(`/v2.3/list/history/${encodeURIComponent(paymentId)}`, {
    body,
    contentType: "application/json",
    timeoutMs: 10_000,
  });
  return historyPayment(paymentId, response);
}

function naverHistoryTime(milliseconds: number) {
  return new Date(milliseconds + 9 * 60 * 60_000).toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

export async function listNaverPaymentIds(startMs: number, endMs: number, maxPages = 5) {
  const ids = new Set<string>();
  const pageLimit = Math.max(1, Math.min(10, maxPages));
  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    const response = await naverRequest<HistoryBody>("/v2.3/list/history", {
      body: JSON.stringify({
        startTime: naverHistoryTime(startMs),
        endTime: naverHistoryTime(endMs),
        approvalType: "ALL",
        pageNumber,
        rowsPerPage: 100,
      }),
      contentType: "application/json",
      timeoutMs: 10_000,
    });
    const items = Array.isArray(response?.list) ? response.list as HistoryItem[] : [];
    for (const item of items) {
      const paymentId = stringValue(item.paymentId);
      if (paymentId) ids.add(paymentId);
    }
    const totalPages = Math.max(1, amountValue(response?.totalPageCount));
    if (pageNumber >= totalPages || items.length === 0) break;
  }
  return [...ids];
}

export async function cancelNaverPayment(
  paymentId: string,
  orderId: string,
  amount: number,
  taxScopeAmount: number,
  taxExScopeAmount: number,
  reason: string,
  requester: "1" | "2",
  idempotencyKey: string,
) {
  const body = new URLSearchParams({
    paymentId,
    merchantPayTransactionKey: `${orderId}-cancel`,
    cancelAmount: String(amount),
    cancelReason: utf8Limit(reason, 256),
    cancelRequester: requester,
    taxScopeAmount: String(taxScopeAmount),
    taxExScopeAmount: String(taxExScopeAmount),
    doCompareRest: "1",
    expectedRestAmount: "0",
  });
  try {
    const result = await naverRequest<CancelBody>("/v1/cancel", {
      body,
      contentType: "application/x-www-form-urlencoded",
      idempotencyKey,
      timeoutMs: 60_000,
    });
    if (!result || typeof result !== "object") {
      throw new NaverPayApiError(409, "NAVER_PAY_INVALID_RESPONSE", "네이버페이 취소 결과를 확인하고 있습니다.");
    }
    const canceledAmount = amountValue(result.primaryPayCancelAmount) + amountValue(result.npointCancelAmount) + amountValue(result.giftCardCancelAmount) + amountValue(result.discountCancelAmount);
    if (
      stringValue(result.paymentId) !== paymentId ||
      amountValue(result.totalRestAmount) !== 0 ||
      canceledAmount !== amount ||
      amountValue(result.taxScopeAmount) !== taxScopeAmount ||
      amountValue(result.taxExScopeAmount) !== taxExScopeAmount
    ) {
      throw new NaverPayApiError(409, "NAVER_PAY_CANCEL_MISMATCH", "네이버페이 취소 결과를 확인하고 있습니다.");
    }
    return {
      paymentKey: paymentId,
      orderId,
      status: "CANCELED",
      method: methodLabel(result.primaryPayMeans, result.npointCancelAmount),
      totalAmount: amount,
      taxScopeAmount,
      taxExScopeAmount,
      balanceAmount: 0,
      receipt: null,
      cancels: [{
        cancelAmount: canceledAmount,
        taxScopeAmount: amountValue(result.taxScopeAmount),
        taxExScopeAmount: amountValue(result.taxExScopeAmount),
        canceledAt: naverDate(result.cancelYmdt),
      }],
    } satisfies NaverPayment;
  } catch (error) {
    if (error instanceof NaverPayApiError && error.code === "AlreadyCanceled") return getNaverPayment(paymentId);
    if (error instanceof NaverPayApiError && error.code === "CancelNotComplete") {
      return {
        paymentKey: paymentId,
        orderId,
        status: "CANCELED",
        method: "네이버페이",
        totalAmount: amount,
        taxScopeAmount,
        taxExScopeAmount,
        balanceAmount: 0,
        receipt: null,
        cancels: [{ cancelAmount: amount, taxScopeAmount, taxExScopeAmount }],
      } satisfies NaverPayment;
    }
    throw error;
  }
}

export function isTransientNaverPayError(error: unknown) {
  if (!(error instanceof NaverPayApiError)) return false;
  return error.status >= 500 || [
    "AlreadyOnGoing",
    "PreCancelNotComplete",
    "MaintenanceOngoing",
    "FaultCheckOngoing",
    "NAVER_PAY_NETWORK_ERROR",
  ].includes(error.code);
}

export function isAmbiguousNaverPayError(error: unknown) {
  return error instanceof NaverPayApiError && [
    "OverRemainAmount",
    "RestAmountDiff",
    "TaxScopeAmtGreaterThanRemainError",
    "NAVER_PAY_CANCEL_MISMATCH",
    "NAVER_PAY_HISTORY_NOT_FOUND",
    "NAVER_PAY_API_ERROR",
    "NAVER_PAY_INVALID_APPROVAL",
    "NAVER_PAY_TAX_MISMATCH",
    "NAVER_PAY_INVALID_RESPONSE",
  ].includes(error.code);
}
