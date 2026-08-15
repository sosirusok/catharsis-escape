"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { apiUrl, publicSiteUrl, themeImageUrl } from "@/lib/client-runtime";
import type { BookingSettingsRecord, PublicDateAvailability, ThemeRecord } from "@/lib/models";

type ReservationSummary = {
  bookingCode: string;
  themeName: string;
  date: string;
  startMinute: number;
  durationMin: number;
  partySize: number;
  priceTotal: number;
  status: string;
  paymentStatus?: string;
  receiptUrl?: string;
};

type TossPaymentCheckout = {
  provider: "toss";
  clientKey: string;
  mode: "test" | "live";
  orderId: string;
  state: string;
  orderName: string;
  amount: number;
  expiresAt: number;
  successUrl: string;
  failUrl: string;
};

type NaverPaymentCheckout = {
  provider: "naverpay";
  clientId: string;
  chainId: string;
  mode: "development" | "production";
  orderId: string;
  state: string;
  orderName: string;
  amount: number;
  taxScopeAmount: number;
  taxExScopeAmount: number;
  expiresAt: number;
  returnUrl: string;
  productItems: Array<Record<string, unknown>>;
};

type PaymentCheckout = TossPaymentCheckout | NaverPaymentCheckout;

type TossPaymentClient = {
  requestPayment(options: Record<string, unknown>): Promise<void>;
};

type TossPaymentsFactory = ((clientKey: string) => { payment(options: { customerKey: string }): TossPaymentClient }) & { ANONYMOUS?: string };

let tossScriptPromise: Promise<TossPaymentsFactory> | null = null;
type NaverPayClient = { open(options: Record<string, unknown>): void };
type NaverPaySdk = { Pay: { create(options: Record<string, unknown>): NaverPayClient } };
let naverScriptPromise: Promise<NaverPaySdk> | null = null;
const PENDING_PAYMENT_KEY = "catharsis.pendingPayment";
const RECENT_RESERVATION_KEY = "catharsis.recentReservation";

type PendingPayment = { state: string; orderId: string; expiresAt: number };
type RecentReservation = ReservationSummary & { savedAt: number };

function policyUrl(path: "privacy" | "terms" | "refund") {
  const configured = publicSiteUrl();
  const base = configured.replace(/\/+$/, "");
  return `${base || ""}/${path}/`;
}

function saveRecentReservation(reservation: ReservationSummary) {
  try {
    localStorage.setItem(RECENT_RESERVATION_KEY, JSON.stringify({ ...reservation, savedAt: Date.now() }));
  } catch {}
}

function readRecentReservation(): RecentReservation | null {
  try {
    const raw = localStorage.getItem(RECENT_RESERVATION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<RecentReservation>;
    if (!value.bookingCode || !/^CT-[2-9A-HJ-NP-Z]{6}$/.test(value.bookingCode) || typeof value.savedAt !== "number") return null;
    if (value.savedAt < Date.now() - 180 * 24 * 60 * 60_000) {
      localStorage.removeItem(RECENT_RESERVATION_KEY);
      return null;
    }
    return value as RecentReservation;
  } catch {
    return null;
  }
}

function clearPendingPayment(expectedState?: string) {
  for (const storage of [sessionStorage, localStorage]) {
    try {
      if (expectedState) {
        const raw = storage.getItem(PENDING_PAYMENT_KEY);
        if (!raw || (JSON.parse(raw) as Partial<PendingPayment>).state !== expectedState) continue;
      }
      storage.removeItem(PENDING_PAYMENT_KEY);
    } catch {}
  }
}

function savePendingPayment(value: string) {
  try { sessionStorage.setItem(PENDING_PAYMENT_KEY, value); } catch {}
  try { localStorage.setItem(PENDING_PAYMENT_KEY, value); } catch {}
}

function readPendingPayment(): PendingPayment | null {
  for (const storage of [sessionStorage, localStorage]) {
    try {
      const raw = storage.getItem(PENDING_PAYMENT_KEY);
      if (!raw) continue;
      const value = JSON.parse(raw) as Partial<PendingPayment>;
      if (
        typeof value.state === "string" && /^[a-f0-9]{64}$/.test(value.state) &&
        typeof value.orderId === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(value.orderId) &&
        typeof value.expiresAt === "number" && value.expiresAt > Date.now()
      ) return value as PendingPayment;
      storage.removeItem(PENDING_PAYMENT_KEY);
    } catch { try { storage.removeItem(PENDING_PAYMENT_KEY); } catch {} }
  }
  return null;
}

function loadTossPayments() {
  if (typeof window === "undefined") return Promise.reject(new Error("결제창을 열 수 없습니다."));
  const current = (window as typeof window & { TossPayments?: TossPaymentsFactory }).TossPayments;
  if (current) return Promise.resolve(current);
  if (tossScriptPromise) return tossScriptPromise;
  tossScriptPromise = new Promise<TossPaymentsFactory>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://js.tosspayments.com/v2/standard";
    script.async = true;
    script.onload = () => {
      const loaded = (window as typeof window & { TossPayments?: TossPaymentsFactory }).TossPayments;
      if (loaded) resolve(loaded);
      else reject(new Error("결제창을 불러오지 못했습니다."));
    };
    script.onerror = () => reject(new Error("결제창을 불러오지 못했습니다."));
    document.head.appendChild(script);
  });
  return tossScriptPromise;
}

function loadNaverPay() {
  if (typeof window === "undefined") return Promise.reject(new Error("결제창을 열 수 없습니다."));
  const current = (window as typeof window & { Naver?: NaverPaySdk }).Naver;
  if (current?.Pay) return Promise.resolve(current);
  if (naverScriptPromise) return naverScriptPromise;
  naverScriptPromise = new Promise<NaverPaySdk>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://nsp.pay.naver.com/sdk/js/naverpay.min.js";
    script.async = true;
    script.onload = () => {
      const loaded = (window as typeof window & { Naver?: NaverPaySdk }).Naver;
      if (loaded?.Pay) resolve(loaded);
      else reject(new Error("네이버페이 결제창을 불러오지 못했습니다."));
    };
    script.onerror = () => reject(new Error("네이버페이 결제창을 불러오지 못했습니다."));
    document.head.appendChild(script);
  });
  return naverScriptPromise;
}

type Props = {
  initialThemes: ThemeRecord[];
  initialSettings: BookingSettingsRecord;
};

function Arrow() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" /></svg>;
}

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length < 4) return digits;
  if (digits.length < 8) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

function formatDate(date: string, includeYear = false) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    ...(includeYear ? { year: "numeric" as const } : {}),
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${date}T12:00:00+09:00`));
}

function minuteToTime(minute: number) {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function cancelCutoffText(minutes: number) {
  if (minutes <= 0) return "이용 시작 전";
  if (minutes % 1440 === 0) return `이용 시작 ${minutes / 1440}일 전`;
  if (minutes % 60 === 0) return `이용 시작 ${minutes / 60}시간 전`;
  return `이용 시작 ${minutes}분 전`;
}

function safeReceiptUrl(value?: string) {
  if (!value) return "";
  try {
    const url = new URL(value);
    const trusted = url.hostname === "tosspayments.com" || url.hostname.endsWith(".tosspayments.com") || url.hostname === "pay.naver.com" || url.hostname.endsWith(".pay.naver.com");
    return url.protocol === "https:" && trusted ? url.toString() : "";
  } catch {
    return "";
  }
}

function newRequestId() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export default function BookingExperience({ initialThemes, initialSettings }: Props) {
  const [themes, setThemes] = useState(initialThemes);
  const [settings, setSettings] = useState(initialSettings);
  const [themeId, setThemeId] = useState(initialThemes[0]?.id || "");
  const [dates, setDates] = useState<PublicDateAvailability[]>([]);
  const [dateKey, setDateKey] = useState("");
  const [slotId, setSlotId] = useState("");
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [people, setPeople] = useState(initialThemes[0]?.minPeople || 2);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [privacyAgreed, setPrivacyAgreed] = useState(false);
  const [termsAndRefundAgreed, setTermsAndRefundAgreed] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState<ReservationSummary | null>(null);
  const [error, setError] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [manageOpen, setManageOpen] = useState(false);
  const [informationOpen, setInformationOpen] = useState<"privacy" | null>(null);
  const [paymentMode, setPaymentMode] = useState<"test" | "live" | "unavailable">("unavailable");
  const requestIdRef = useRef(newRequestId());
  const availabilityRequestRef = useRef(0);

  const selectedTheme = themes.find((theme) => theme.id === themeId) || themes[0];
  const selectedDate = dates.find((date) => date.date === dateKey);
  const selectedSlot = selectedDate?.slots.find((slot) => slot.id === slotId);
  const ready = Boolean(paymentMode !== "unavailable" && selectedTheme && selectedDate && selectedSlot?.status === "available" && name.trim().length >= 2 && phone.replace(/\D/g, "").length >= 10 && privacyAgreed && termsAndRefundAgreed);

  useEffect(() => {
    fetch(apiUrl("/api/public/bootstrap"), { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (!data.ok) return;
        setThemes(data.themes);
        setSettings(data.settings);
        setPaymentMode(data.payments?.configured ? (data.payments.mode === "live" ? "live" : "test") : "unavailable");
        setThemeId((current) => data.themes.some((theme: ThemeRecord) => theme.id === current) ? current : data.themes[0]?.id || "");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!themeId) return;
    const controller = new AbortController();
    const generation = ++availabilityRequestRef.current;
    queueMicrotask(() => { setLoadingSlots(true); setSlotId(""); });
    fetch(apiUrl(`/api/public/availability?themeId=${encodeURIComponent(themeId)}&days=${settings.horizonDays}`), { cache: "no-store", signal: controller.signal })
      .then((response) => response.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error?.message || "예약 시간을 불러오지 못했습니다.");
        setDates(data.dates);
        setDateKey((current) => data.dates.some((date: PublicDateAvailability) => date.date === current) ? current : data.dates[0]?.date || "");
        setError("");
      })
      .catch((caught) => {
        if (caught.name !== "AbortError") setError(caught.message);
      })
      .finally(() => { if (availabilityRequestRef.current === generation) setLoadingSlots(false); });
    return () => controller.abort();
  }, [themeId, settings.horizonDays]);

  useEffect(() => {
    if (!selectedTheme) return;
    queueMicrotask(() => setPeople((current) => Math.max(selectedTheme.minPeople, Math.min(selectedTheme.maxPeople, current))));
  }, [selectedTheme]);

  const selectTheme = (id: string) => {
    setThemeId(id);
    setSlotId("");
    setError("");
  };

  useEffect(() => {
    const select = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (themes.some((theme) => theme.id === id)) selectTheme(id);
    };
    window.addEventListener("select-booking-theme", select);
    return () => window.removeEventListener("select-booking-theme", select);
  }, [themes]);

  useEffect(() => {
    const openManager = () => setManageOpen(true);
    window.addEventListener("open-booking-manager", openManager);
    return () => window.removeEventListener("open-booking-manager", openManager);
  }, []);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const payment = hash.get("payment");
    const cleanAddress = () => window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    if (payment === "fail") {
      const state = hash.get("state") || "";
      const pending = readPendingPayment();
      const message = hash.get("message") || "결제가 취소되었습니다. 예약은 확정되지 않았습니다.";
      queueMicrotask(() => {
        if (pending?.state === state) clearPendingPayment(state);
        setPaymentError(message);
        setReviewing(false);
        requestIdRef.current = newRequestId();
        cleanAddress();
      });
      return;
    }
    const pending = payment === "success" || payment === "processing"
      ? { state: hash.get("state") || "", orderId: hash.get("orderId") || "", expiresAt: Date.now() + 60_000 }
      : readPendingPayment();
    if (!pending || !/^[a-f0-9]{64}$/.test(pending.state) || !/^[A-Za-z0-9_-]{6,64}$/.test(pending.orderId)) return;
    const { state, orderId } = pending;
    const explicitReturn = payment === "success" || payment === "processing";
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (explicitReturn) {
        setSubmitting(true);
        setPaymentError("");
      }
      try {
        let lastError = "결제 승인을 확인하지 못했습니다.";
        const attempts = explicitReturn ? 5 : 1;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          const response = await fetch(apiUrl("/api/public/payments/result"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state, orderId }),
          });
          const data = await response.json();
          if (response.ok && data.ok) {
            if (!cancelled) {
              clearPendingPayment(state);
              saveRecentReservation(data.reservation);
              setCompleted(data.reservation);
              requestIdRef.current = newRequestId();
              setSlotId("");
              cleanAddress();
            }
            return;
          }
          lastError = data.error?.message || lastError;
          if (!explicitReturn && (response.status === 404 || response.status === 409)) return;
          if ((response.status !== 409 && response.status < 500) || attempt === attempts - 1) {
            if (response.status === 410) clearPendingPayment(state);
            throw new Error(lastError);
          }
          await new Promise((resolve) => window.setTimeout(resolve, 1200));
        }
      } catch (caught) {
        if (!cancelled && explicitReturn) setPaymentError(caught instanceof Error ? caught.message : "결제 결과를 확인하지 못했습니다. 매장으로 문의해 주세요.");
      } finally {
        if (!cancelled && explicitReturn) setSubmitting(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!reviewing && !completed && !manageOpen && !informationOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || submitting) return;
      if (informationOpen) setInformationOpen(null);
      else if (manageOpen) setManageOpen(false);
      else if (reviewing) setReviewing(false);
      else setCompleted(null);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [completed, informationOpen, manageOpen, reviewing, submitting]);

  const submitReview = (event: FormEvent) => {
    event.preventDefault();
    if (ready) setReviewing(true);
  };

  const confirmReservation = async () => {
    if (!ready || !selectedSlot) return;
    setSubmitting(true);
    setError("");
    setPaymentError("");
    try {
      const response = await fetch(apiUrl("/api/public/payments/checkout"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slotId: selectedSlot.id,
          partySize: people,
          name,
          phone,
          consentAccepted: true,
          termsAccepted: true,
          refundPolicyAccepted: true,
          consentVersion: settings.consentVersion,
          termsVersion: settings.termsVersion,
          refundPolicyVersion: settings.refundPolicyVersion,
          requestId: requestIdRef.current,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        if (["CHECKOUT_EXPIRED", "SLOT_TAKEN", "REQUEST_REUSED"].includes(data.error?.code)) requestIdRef.current = newRequestId();
        throw new Error(data.error?.message || "결제를 시작하지 못했습니다.");
      }
      const checkout = data.payment as PaymentCheckout;
      const reviewedAmount = Number(selectedTheme?.prices[String(people)] || 0);
      if (checkout.amount !== reviewedAmount) {
        setThemes((current) => current.map((theme) => theme.id === selectedTheme?.id ? { ...theme, prices: { ...theme.prices, [String(people)]: checkout.amount } } : theme));
        setReviewing(false);
        throw new Error(`이용 요금이 ${checkout.amount.toLocaleString("ko-KR")}원으로 변경되었습니다. 변경된 금액을 확인한 뒤 다시 결제해 주세요.`);
      }
      const pendingPayment = JSON.stringify({ orderId: checkout.orderId, state: checkout.state, expiresAt: checkout.expiresAt + 24 * 60 * 60_000 });
      savePendingPayment(pendingPayment);
      if (checkout.provider === "naverpay") {
        const Naver = await loadNaverPay();
        const payment = Naver.Pay.create({
          mode: checkout.mode,
          payType: "normal",
          openType: "page",
          clientId: checkout.clientId,
          chainId: checkout.chainId,
        });
        payment.open({
          merchantPayKey: checkout.orderId,
          productName: checkout.orderName,
          productCount: 1,
          totalPayAmount: checkout.amount,
          taxScopeAmount: checkout.taxScopeAmount,
          taxExScopeAmount: checkout.taxExScopeAmount,
          returnUrl: checkout.returnUrl,
          productItems: checkout.productItems,
        });
      } else {
        const TossPayments = await loadTossPayments();
        const payment = TossPayments(checkout.clientKey).payment({ customerKey: TossPayments.ANONYMOUS || "ANONYMOUS" });
        await payment.requestPayment({
          method: "CARD",
          amount: { currency: "KRW", value: checkout.amount },
          orderId: checkout.orderId,
          orderName: checkout.orderName,
          customerName: name,
          customerMobilePhone: phone.replace(/\D/g, ""),
          successUrl: checkout.successUrl,
          failUrl: checkout.failUrl,
          windowTarget: "self",
          card: { flowMode: "DEFAULT", useEscrow: false, useCardPoint: false, useAppCardOnly: false },
        });
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "결제를 시작하지 못했습니다.";
      if (!/취소|PAY_PROCESS_CANCELED|UserCancel/i.test(message)) setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <section className="booking-section" id="booking">
        <aside className="booking-intro">
          <h2>예약하기</h2>
          <p>테마와 시간을 고른 뒤 예약자 정보를 입력해 주세요.</p>
          <button type="button" onClick={() => setManageOpen(true)}>예약 조회·취소 <Arrow /></button>
        </aside>

        <form className="booking-form" onSubmit={submitReview}>
          {!settings.bookingOpen && <div className="booking-paused"><strong>예약 접수 일시 중지</strong><span>{settings.pausedMessage}</span></div>}
          <fieldset className="form-block" disabled={!settings.bookingOpen}>
            <legend><span>1</span> 테마 선택</legend>
            <div className="booking-theme-grid">
              {themes.map((theme) => (
                <button type="button" key={theme.id} className={themeId === theme.id ? "booking-theme selected" : "booking-theme"} onClick={() => selectTheme(theme.id)} aria-pressed={themeId === theme.id}>
                  <span className={`booking-thumb ${theme.artKey} ${theme.imageKey ? "has-image" : ""}`} style={theme.imageKey ? { backgroundImage: `url(${themeImageUrl(theme.imageKey)})` } : undefined} />
                  <span><small>{theme.genre}</small><strong>{theme.shortName}</strong><em>{theme.durationMin}분 · {theme.minPeople}–{theme.maxPeople}인</em></span>
                  <i aria-hidden="true" />
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="form-block" disabled={!settings.bookingOpen}>
            <legend><span>2</span> 날짜 선택</legend>
            <div className="date-scroller" aria-busy={loadingSlots}>
              {dates.map((date, index) => {
                const parsed = new Date(`${date.date}T12:00:00+09:00`);
                return (
                  <button type="button" key={date.date} disabled={date.closed || !date.slots.some((slot) => slot.status === "available")} className={dateKey === date.date ? "date-button selected" : "date-button"} onClick={() => { setDateKey(date.date); setSlotId(""); }} aria-pressed={dateKey === date.date}>
                    <small>{index === 0 ? "오늘" : new Intl.DateTimeFormat("ko-KR", { weekday: "short", timeZone: "Asia/Seoul" }).format(parsed)}</small>
                    <strong>{parsed.getDate()}</strong>
                    <span>{parsed.getMonth() + 1}월</span>
                  </button>
                );
              })}
              {loadingSlots && <div className="date-loading">예약 가능 날짜를 확인하고 있습니다.</div>}
              {!loadingSlots && dates.length === 0 && <div className="date-loading" role="status">{error || "현재 예약 가능한 날짜가 없습니다."}</div>}
            </div>
          </fieldset>

          <fieldset className="form-block" disabled={!settings.bookingOpen}>
            <legend><span>3</span> 시간 선택</legend>
            <div className="slot-header"><strong>{selectedDate ? formatDate(selectedDate.date) : "날짜를 선택해 주세요."}</strong><span>예약 가능 시간</span></div>
            <div className="time-grid">
              {selectedDate?.slots.map((slot) => (
                <button type="button" key={slot.id} disabled={slot.status !== "available"} className={slotId === slot.id ? "time-button selected" : "time-button"} onClick={() => setSlotId(slot.id)} aria-pressed={slotId === slot.id}>
                  <strong>{slot.time}</strong>
                  <small>{slot.status === "available" ? "예약 가능" : slot.status === "held" ? "결제 진행 중" : slot.status === "booked" ? "예약 완료" : slot.status === "blocked" ? "마감" : "접수 마감"}</small>
                </button>
              ))}
              {!selectedDate && <p className="no-slots">날짜를 선택하면 예약 가능 시간이 표시됩니다.</p>}
              {!loadingSlots && selectedDate && selectedDate.slots.length === 0 && <p className="no-slots">선택한 날짜에는 운영 시간이 없습니다.</p>}
            </div>
          </fieldset>

          <fieldset className="form-block" disabled={!settings.bookingOpen}>
            <legend><span>4</span> 예약자 정보</legend>
            <div className="guest-grid">
              <div className="field"><label>인원</label><div className="stepper"><button type="button" onClick={() => setPeople(Math.max(selectedTheme?.minPeople || 1, people - 1))} aria-label="인원 줄이기">−</button><output><strong>{people}</strong>명</output><button type="button" onClick={() => setPeople(Math.min(selectedTheme?.maxPeople || 5, people + 1))} aria-label="인원 늘리기">＋</button></div></div>
              <div className="field"><label htmlFor="guest-name">대표자 이름</label><input id="guest-name" value={name} onChange={(event) => setName(event.target.value.slice(0, 30))} placeholder="이름" autoComplete="name" required /></div>
              <div className="field"><label htmlFor="guest-phone">대표자 전화번호</label><input id="guest-phone" type="tel" inputMode="numeric" value={phone} onChange={(event) => setPhone(formatPhone(event.target.value))} placeholder="010-0000-0000" autoComplete="tel" required /></div>
            </div>
            <div className="consent-stack">
              <div className="consent-row">
                <label className="consent"><input type="checkbox" checked={privacyAgreed} onChange={(event) => setPrivacyAgreed(event.target.checked)} /><span aria-hidden="true" /><b>(필수)</b> 예약을 위한 개인정보 처리에 동의합니다.</label>
                <button className="privacy-open" type="button" onClick={() => setInformationOpen("privacy")}>내용 보기</button>
              </div>
              <div className="consent-row">
                <label className="consent"><input type="checkbox" checked={termsAndRefundAgreed} onChange={(event) => setTermsAndRefundAgreed(event.target.checked)} /><span aria-hidden="true" /><b>(필수)</b> 이용약관 및 취소·환불정책에 동의합니다.</label>
                <span className="consent-links"><a href={policyUrl("terms")} target="_blank" rel="noreferrer">이용약관</a><a href={policyUrl("refund")} target="_blank" rel="noreferrer">환불정책</a></span>
              </div>
            </div>
          </fieldset>

          {(paymentError || error) && <div className="booking-error" role="alert">{paymentError || error}</div>}
          {paymentMode === "unavailable" && <div className="booking-payment-unavailable"><strong>온라인 결제를 준비하고 있습니다.</strong><span>{settings.storePhone ? `예약 문의 ${settings.storePhone}` : "결제기관 운영 설정이 끝난 뒤 결제가 열립니다."}</span></div>}
          <div className="booking-summary">
            <div><span>예약 내용</span><strong>{selectedTheme?.name || "테마 선택"}</strong><p>{selectedDate ? formatDate(selectedDate.date) : "날짜 미선택"} {selectedSlot?.time || "시간 미선택"} · {people}명</p></div>
            <button type="submit" disabled={!ready}>예약 내용 확인 <Arrow /></button>
          </div>
        </form>
      </section>

      {reviewing && selectedTheme && selectedDate && selectedSlot && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => !submitting && setReviewing(false)}>
          <section className="review-modal" role="dialog" aria-modal="true" aria-labelledby="review-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setReviewing(false)} disabled={submitting} aria-label="닫기">×</button>
            <h2 id="review-title">예약 내용을 확인해 주세요.</h2>
            <dl><div><dt>테마</dt><dd>{selectedTheme.name}</dd></div><div><dt>일시</dt><dd>{formatDate(selectedDate.date, true)} {selectedSlot.time}</dd></div><div><dt>인원</dt><dd>{people}명</dd></div><div><dt>대표자</dt><dd>{name}</dd></div><div><dt>연락처</dt><dd>{phone}</dd></div>{selectedTheme.prices[String(people)] && <div><dt>이용 요금</dt><dd>{selectedTheme.prices[String(people)].toLocaleString("ko-KR")}원</dd></div>}</dl>
            <div className="refund-summary"><strong>취소·환불 안내</strong><p>{cancelCutoffText(settings.cancelCutoffMinutes)}까지 취소하면 전액 환불됩니다. 이후 취소는 매장으로 문의해 주세요.</p><a href={policyUrl("refund")} target="_blank" rel="noreferrer">전체 정책 보기</a></div>
            <p className="booking-next">네이버페이에서 결제가 승인되고 예약번호가 발급되면 예약이 확정됩니다.</p>
            <div className="modal-actions"><button className="button primary" onClick={confirmReservation} disabled={submitting}>{submitting ? "결제창 여는 중…" : `네이버페이로 ${Number(selectedTheme.prices[String(people)] || 0).toLocaleString("ko-KR")}원 결제`} <Arrow /></button><button className="button quiet" onClick={() => setReviewing(false)} disabled={submitting}>다시 선택</button></div>
          </section>
        </div>
      )}

      {completed && <SuccessModal reservation={completed} onClose={() => setCompleted(null)} onManage={() => { setCompleted(null); setManageOpen(true); }} />}
      {manageOpen && <ManageReservation onClose={() => setManageOpen(false)} />}
      {informationOpen && <InformationModal kind={informationOpen} settings={settings} onClose={() => setInformationOpen(null)} />}
    </>
  );
}

function InformationModal({ settings, onClose }: { kind: "privacy"; settings: BookingSettingsRecord; onClose: () => void }) {
  const operationalDays = Math.max(30, Number(settings.operationalPiiRetentionDays || 90));
  const legalMonths = Math.max(60, Number(settings.legalRecordRetentionMonths || 60));
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="review-modal privacy-modal" role="dialog" aria-modal="true" aria-labelledby="information-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" type="button" onClick={onClose} aria-label="닫기">×</button>
        <h2 id="information-title">개인정보 처리 안내</h2>
        <dl className="privacy-list"><div><dt>처리 목적</dt><dd>예약 접수·본인 확인·결제·예약 확정·취소·환불 및 분쟁 처리</dd></div><div><dt>처리 항목</dt><dd>이름, 휴대전화번호, 테마, 이용일시, 인원, 예약번호와 주문·결제·환불 정보</dd></div><div><dt>보유 기간</dt><dd>운영용 예약정보는 이용일 또는 취소 후 {operationalDays}일, 계약·결제 기록은 {legalMonths}개월, 불만·분쟁 기록은 3년 보관 후 파기</dd></div></dl><p className="privacy-note">동의를 거부할 수 있으나, 예약계약 이행에 필요한 정보이므로 동의하지 않으면 온라인 예약을 진행할 수 없습니다.</p><a className="policy-detail-link" href={policyUrl("privacy")} target="_blank" rel="noreferrer">개인정보 처리방침 전체 보기</a>
        <button className="button primary privacy-confirm" type="button" onClick={onClose}>확인</button>
      </section>
    </div>
  );
}

function SuccessModal({ reservation, onClose, onManage }: { reservation: ReservationSummary; onClose: () => void; onManage: () => void }) {
  const [copied, setCopied] = useState(false);
  const copyCode = async () => {
    try { await navigator.clipboard.writeText(reservation.bookingCode); setCopied(true); }
    catch { setCopied(false); }
  };
  const receiptUrl = safeReceiptUrl(reservation.receiptUrl);
  return <div className="modal-backdrop"><section className="review-modal success-modal printable-reservation" role="dialog" aria-modal="true" aria-labelledby="success-title"><div className="success-seal">✓</div><h2 id="success-title">예약이 확정되었습니다.</h2><p className="success-lead">결제가 완료되었습니다.</p><div className="booking-code"><span>예약번호</span><strong>{reservation.bookingCode}</strong><button type="button" onClick={copyCode}>{copied ? "복사됨" : "복사"}</button></div><dl><div><dt>테마</dt><dd>{reservation.themeName}</dd></div><div><dt>일시</dt><dd>{formatDate(reservation.date, true)} {minuteToTime(reservation.startMinute)}</dd></div><div><dt>인원</dt><dd>{reservation.partySize}명</dd></div>{reservation.priceTotal > 0 && <div><dt>결제 금액</dt><dd>{reservation.priceTotal.toLocaleString("ko-KR")}원</dd></div>}</dl><div className="success-tools"><button type="button" onClick={() => window.print()}>예약 내역 인쇄</button>{receiptUrl && <a href={receiptUrl} target="_blank" rel="noreferrer">결제 영수증</a>}</div><p className="booking-next">예약번호를 캡처해 두세요. 예약 조회와 취소에도 사용됩니다.</p><div className="success-actions"><button className="button quiet" onClick={onManage}>예약 내역 보기</button><button className="button primary" onClick={onClose}>확인</button></div></section></div>;
}

function ManageReservation({ onClose }: { onClose: () => void }) {
  const [bookingCode, setBookingCode] = useState("");
  const [phone, setPhone] = useState("");
  const [reservation, setReservation] = useState<ReservationSummary | null>(null);
  const [recent, setRecent] = useState<RecentReservation | null>(() => readRecentReservation());
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const lookup = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true); setError("");
    try { const response = await fetch(apiUrl("/api/public/reservations/lookup"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookingCode, phone }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error?.message); saveRecentReservation(data.reservation); setRecent({ ...data.reservation, savedAt: Date.now() }); setReservation(data.reservation); } catch (caught) { setError(caught instanceof Error ? caught.message : "예약을 찾지 못했습니다."); } finally { setLoading(false); }
  };
  const cancel = async () => {
    const paid = reservation?.paymentStatus === "paid";
    if (!confirm(paid ? "예약을 취소하고 결제 금액을 원래 결제수단으로 환불하시겠습니까?" : "예약을 취소하시겠습니까?")) return;
    setLoading(true); setError("");
    try { const response = await fetch(apiUrl("/api/public/reservations/cancel"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookingCode, phone }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error?.message); setReservation((current) => { if (!current) return null; const next = { ...current, status: "cancelled", paymentStatus: data.refunded ? "refunded" : current.paymentStatus }; saveRecentReservation(next); setRecent({ ...next, savedAt: Date.now() }); return next; }); } catch (caught) { setError(caught instanceof Error ? caught.message : "취소하지 못했습니다."); } finally { setLoading(false); }
  };
  const paymentStatus = reservation?.paymentStatus || "manual";
  const paid = paymentStatus === "paid";
  const refunding = paymentStatus === "refund_processing";
  const refunded = paymentStatus === "refunded";
  const cancelled = reservation?.status === "cancelled";
  const statusText = refunded
    ? "취소·환불 완료"
    : refunding
      ? "취소·환불 처리 중"
      : cancelled && paid
        ? "예약 취소 · 결제 취소 확인 필요"
        : cancelled
          ? "예약 취소 완료"
          : paid
            ? "결제·예약 완료"
            : "예약 확정";
  const receiptUrl = safeReceiptUrl(reservation?.receiptUrl);
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="review-modal manage-modal" role="dialog" aria-modal="true" aria-labelledby="manage-title" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={onClose} aria-label="닫기">×</button><h2 id="manage-title">예약 조회·취소</h2>{!reservation ? <form className="lookup-form" onSubmit={lookup}>{recent && <button className="recent-reservation" type="button" onClick={() => { setBookingCode(recent.bookingCode); setError(""); }}><span>이 기기의 최근 예약</span><strong>{recent.bookingCode}</strong><small>{recent.themeName} · {formatDate(recent.date)} {minuteToTime(recent.startMinute)}</small></button>}<label>예약번호<input value={bookingCode} onChange={(event) => setBookingCode(event.target.value.toUpperCase().slice(0, 9))} placeholder="CT-XXXXXX" autoComplete="off" /></label><label>예약자 휴대전화번호<input type="tel" inputMode="numeric" value={phone} onChange={(event) => setPhone(formatPhone(event.target.value))} placeholder="010-0000-0000" autoComplete="tel" /></label>{error && <div className="booking-error">{error}</div>}<button className="button primary" disabled={loading}>{loading ? "조회 중…" : "예약 조회"}</button></form> : <><div className={`reservation-state ${cancelled ? "cancelled" : paymentStatus}`}>{statusText}</div><div className="booking-code"><span>예약번호</span><strong>{reservation.bookingCode}</strong></div><dl><div><dt>테마</dt><dd>{reservation.themeName}</dd></div><div><dt>일시</dt><dd>{formatDate(reservation.date, true)} {minuteToTime(reservation.startMinute)}</dd></div><div><dt>인원</dt><dd>{reservation.partySize}명</dd></div>{reservation.priceTotal > 0 && <div><dt>결제 금액</dt><dd>{reservation.priceTotal.toLocaleString("ko-KR")}원</dd></div>}</dl>{receiptUrl && <a className="receipt-link" href={receiptUrl} target="_blank" rel="noreferrer">결제 영수증 보기</a>}{error && <div className="booking-error">{error}</div>}<div className="modal-actions">{reservation.status === "confirmed" && !refunding && !refunded && <button className="button danger" onClick={cancel} disabled={loading}>{loading ? (paid ? "환불 처리 중…" : "취소 처리 중…") : paid ? "예약 취소·결제 환불" : "예약 취소"}</button>}<button className="button quiet" onClick={() => { setReservation(null); setError(""); }}>다른 예약 조회</button></div></>}</section></div>;
}
