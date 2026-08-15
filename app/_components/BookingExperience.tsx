"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { apiUrl, themeImageUrl } from "@/lib/client-runtime";
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
};

type PaymentCheckout = {
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

type TossPaymentClient = {
  requestPayment(options: Record<string, unknown>): Promise<void>;
};

type TossPaymentsFactory = ((clientKey: string) => { payment(options: { customerKey: string }): TossPaymentClient }) & { ANONYMOUS?: string };

let tossScriptPromise: Promise<TossPaymentsFactory> | null = null;
const PENDING_PAYMENT_KEY = "catharsis.pendingPayment";

type PendingPayment = { state: string; orderId: string; expiresAt: number };

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
  const [agreed, setAgreed] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState<ReservationSummary | null>(null);
  const [error, setError] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [manageOpen, setManageOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [paymentMode, setPaymentMode] = useState<"test" | "live" | "unavailable">("unavailable");
  const requestIdRef = useRef(newRequestId());
  const availabilityRequestRef = useRef(0);

  const selectedTheme = themes.find((theme) => theme.id === themeId) || themes[0];
  const selectedDate = dates.find((date) => date.date === dateKey);
  const selectedSlot = selectedDate?.slots.find((slot) => slot.id === slotId);
  const ready = Boolean(paymentMode !== "unavailable" && selectedTheme && selectedDate && selectedSlot?.status === "available" && name.trim().length >= 2 && phone.replace(/\D/g, "").length >= 10 && agreed);

  useEffect(() => {
    fetch(apiUrl("/api/public/bootstrap"), { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (!data.ok) return;
        setThemes(data.themes);
        setSettings(data.settings);
        setPaymentMode(data.payments?.mode === "live" ? "live" : data.payments?.configured ? "test" : "unavailable");
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
    if (!reviewing && !completed && !manageOpen && !privacyOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || submitting) return;
      if (privacyOpen) setPrivacyOpen(false);
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
  }, [completed, manageOpen, privacyOpen, reviewing, submitting]);

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
          consentVersion: settings.consentVersion,
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
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "결제를 시작하지 못했습니다.";
      if (!/취소|PAY_PROCESS_CANCELED/i.test(message)) setError(message);
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
                  <span className={`booking-thumb ${theme.artKey}`} style={theme.imageKey ? { backgroundImage: `url(${themeImageUrl(theme.imageKey)})` } : undefined} />
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
            </div>
          </fieldset>

          <fieldset className="form-block" disabled={!settings.bookingOpen}>
            <legend><span>3</span> 시간 선택</legend>
            <div className="slot-header"><strong>{selectedDate ? formatDate(selectedDate.date) : "날짜를 선택해 주세요."}</strong><span>실시간 예약 현황</span></div>
            <div className="time-grid">
              {selectedDate?.slots.map((slot) => (
                <button type="button" key={slot.id} disabled={slot.status !== "available"} className={slotId === slot.id ? "time-button selected" : "time-button"} onClick={() => setSlotId(slot.id)} aria-pressed={slotId === slot.id}>
                  <strong>{slot.time}</strong>
                  <small>{slot.status === "available" ? "예약 가능" : slot.status === "held" ? "결제 진행 중" : slot.status === "booked" ? "예약 완료" : slot.status === "blocked" ? "마감" : "접수 마감"}</small>
                </button>
              ))}
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
            <div className="consent-row">
              <label className="consent"><input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} /><span aria-hidden="true" /><b>(필수)</b> 개인정보 수집·이용에 동의합니다.</label>
              <button className="privacy-open" type="button" onClick={() => setPrivacyOpen(true)}>내용 보기</button>
            </div>
          </fieldset>

          {(paymentError || error) && <div className="booking-error" role="alert">{paymentError || error}</div>}
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
            <p className="modal-kicker">FINAL CHECK</p><h2 id="review-title">예약 내용을 확인해 주세요.</h2>
            <dl><div><dt>테마</dt><dd>{selectedTheme.name}</dd></div><div><dt>일시</dt><dd>{formatDate(selectedDate.date, true)} {selectedSlot.time}</dd></div><div><dt>인원</dt><dd>{people}명</dd></div><div><dt>대표자</dt><dd>{name}</dd></div><div><dt>연락처</dt><dd>{phone}</dd></div>{selectedTheme.prices[String(people)] && <div><dt>이용 요금</dt><dd>{selectedTheme.prices[String(people)].toLocaleString("ko-KR")}원</dd></div>}</dl>
            <p className="booking-next">카드결제가 승인되면 예약번호가 생성되고 예약이 확정됩니다.</p>
            {paymentMode === "test" && <div className="payment-test-notice"><strong>결제 연동 점검 모드</strong><span>현재 결제창에서는 실제 금액이 청구되지 않습니다.</span></div>}
            <div className="modal-actions"><button className="button primary" onClick={confirmReservation} disabled={submitting}>{submitting ? "결제창 여는 중…" : "카드결제 후 예약 확정"} <Arrow /></button><button className="button quiet" onClick={() => setReviewing(false)} disabled={submitting}>다시 선택</button></div>
          </section>
        </div>
      )}

      {completed && <SuccessModal reservation={completed} onClose={() => setCompleted(null)} />}
      {manageOpen && <ManageReservation onClose={() => setManageOpen(false)} />}
      {privacyOpen && <PrivacyModal onClose={() => setPrivacyOpen(false)} />}
    </>
  );
}

function PrivacyModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="review-modal privacy-modal" role="dialog" aria-modal="true" aria-labelledby="privacy-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" type="button" onClick={onClose} aria-label="닫기">×</button>
        <p className="modal-kicker">PRIVACY</p>
        <h2 id="privacy-title">개인정보 수집·이용 안내</h2>
        <dl className="privacy-list">
          <div><dt>수집 목적</dt><dd>예약·결제 처리, 예약자 확인, 이용 안내, 예약 변경·취소 및 환불 처리</dd></div>
          <div><dt>수집 항목</dt><dd>대표자 이름, 전화번호, 예약 테마, 날짜, 시간, 이용 인원</dd></div>
          <div><dt>보유 기간</dt><dd>예약 운영 및 관계 법령상 의무 이행에 필요한 기간 동안 보관한 뒤 안전하게 파기합니다.</dd></div>
        </dl>
        <p className="privacy-note">동의를 거부할 수 있으나, 필수 정보 수집에 동의하지 않으면 예약 접수가 제한됩니다.</p>
        <button className="button primary privacy-confirm" type="button" onClick={onClose}>확인</button>
      </section>
    </div>
  );
}

function SuccessModal({ reservation, onClose }: { reservation: ReservationSummary; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copyCode = async () => {
    try { await navigator.clipboard.writeText(reservation.bookingCode); setCopied(true); }
    catch { setCopied(false); }
  };
  return <div className="modal-backdrop"><section className="review-modal success-modal" role="dialog" aria-modal="true" aria-labelledby="success-title"><div className="success-seal">✓</div><p className="modal-kicker">PAYMENT COMPLETE</p><h2 id="success-title">결제와 예약이 완료되었습니다.</h2><div className="booking-code"><span>예약번호</span><strong>{reservation.bookingCode}</strong><button type="button" onClick={copyCode}>{copied ? "복사됨" : "복사"}</button></div><dl><div><dt>테마</dt><dd>{reservation.themeName}</dd></div><div><dt>일시</dt><dd>{formatDate(reservation.date, true)} {minuteToTime(reservation.startMinute)}</dd></div><div><dt>인원</dt><dd>{reservation.partySize}명</dd></div>{reservation.priceTotal > 0 && <div><dt>결제 금액</dt><dd>{reservation.priceTotal.toLocaleString("ko-KR")}원</dd></div>}</dl><p className="booking-next">예약 조회와 취소에 예약번호가 필요합니다. 화면을 저장해 주세요.</p><button className="button primary success-close" onClick={onClose}>확인</button></section></div>;
}

function ManageReservation({ onClose }: { onClose: () => void }) {
  const [bookingCode, setBookingCode] = useState("");
  const [phone, setPhone] = useState("");
  const [reservation, setReservation] = useState<ReservationSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const lookup = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true); setError("");
    try { const response = await fetch(apiUrl("/api/public/reservations/lookup"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookingCode, phone }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error?.message); setReservation(data.reservation); } catch (caught) { setError(caught instanceof Error ? caught.message : "예약을 찾지 못했습니다."); } finally { setLoading(false); }
  };
  const cancel = async () => {
    if (!confirm("예약을 취소하고 결제금액을 카드 환불하시겠습니까?")) return;
    setLoading(true); setError("");
    try { const response = await fetch(apiUrl("/api/public/reservations/cancel"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookingCode, phone }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error?.message); setReservation((current) => current ? { ...current, status: "cancelled" } : null); } catch (caught) { setError(caught instanceof Error ? caught.message : "취소하지 못했습니다."); } finally { setLoading(false); }
  };
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="review-modal manage-modal" role="dialog" aria-modal="true" aria-labelledby="manage-title" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={onClose} aria-label="닫기">×</button><p className="modal-kicker">MY RESERVATION</p><h2 id="manage-title">예약 조회·취소</h2>{!reservation ? <form className="lookup-form" onSubmit={lookup}><label>예약번호<input value={bookingCode} onChange={(event) => setBookingCode(event.target.value.toUpperCase().slice(0, 9))} placeholder="CT-XXXXXX" /></label><label>예약자 전화번호<input type="tel" inputMode="numeric" value={phone} onChange={(event) => setPhone(formatPhone(event.target.value))} placeholder="010-0000-0000" /></label>{error && <div className="booking-error">{error}</div>}<button className="button primary" disabled={loading}>{loading ? "조회 중…" : "예약 조회"}</button></form> : <><div className={`reservation-state ${reservation.status}`}>{reservation.status === "cancelled" ? "취소·환불 완료" : "결제·예약 완료"}</div><div className="booking-code"><span>예약번호</span><strong>{reservation.bookingCode}</strong></div><dl><div><dt>테마</dt><dd>{reservation.themeName}</dd></div><div><dt>일시</dt><dd>{formatDate(reservation.date, true)} {minuteToTime(reservation.startMinute)}</dd></div><div><dt>인원</dt><dd>{reservation.partySize}명</dd></div></dl>{error && <div className="booking-error">{error}</div>}<div className="modal-actions">{reservation.status === "confirmed" && <button className="button danger" onClick={cancel} disabled={loading}>{loading ? "환불 처리 중…" : "예약 취소·카드 환불"}</button>}<button className="button quiet" onClick={() => setReservation(null)}>다른 예약 조회</button></div></>}</section></div>;
}
