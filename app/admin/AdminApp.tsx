"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  adminRequestHeaders,
  apiUrl,
  clearAdminSessionToken,
  notifyAdminSessionExpired,
  publicSiteUrl,
  themeImageUrl,
  usesRemoteApi,
} from "@/lib/client-runtime";
import ThemePosterArt from "@/app/_components/ThemePosterArt";

type Tab = "dashboard" | "reservations" | "schedule" | "themes" | "closures" | "settings";
type ThemeRow = Record<string, unknown>;
type ReservationRow = Record<string, unknown>;
type SettingsRow = Record<string, unknown>;

const tabNames: Record<Tab, string> = {
  dashboard: "오늘",
  reservations: "예약 관리",
  schedule: "운영 일정",
  themes: "테마 관리",
  closures: "휴무 관리",
  settings: "예약 설정",
};

function dateKey(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(date);
}

function minuteToTime(value: unknown) {
  const minute = Number(value);
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function displayDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long", timeZone: "Asia/Seoul" }).format(new Date(`${value}T12:00:00+09:00`));
}

function statusLabel(status: unknown) {
  return ({ confirmed: "예약 확정", cancelled: "취소", checked_in: "입장", completed: "이용 완료", no_show: "미방문" } as Record<string, string>)[String(status)] || String(status);
}

function reservationStatusLabel(item: ReservationRow) {
  const payment = String(item.payment_status || "manual");
  if (payment === "ready") return "결제 대기";
  if (payment === "confirming") return "승인 확인 중";
  if (payment === "review_required") return "결제 확인 필요";
  if (payment === "refund_processing") return "환불 처리 중";
  if (payment === "refunded") return "취소·환불";
  return statusLabel(item.status);
}

async function api(path: string, options?: RequestInit) {
  const method = String(options?.method || "GET").toUpperCase();
  const headers = new Headers(options?.headers);
  if (options?.body && typeof options.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) headers.set("X-Catharsis-Admin-Request", "1");
  const response = await fetch(apiUrl(path), { ...options, method, headers: adminRequestHeaders(headers), credentials: usesRemoteApi() ? "omit" : "same-origin", cache: "no-store" });
  const data = await response.json();
  if (response.status === 401) {
    notifyAdminSessionExpired();
    throw new Error("관리자 키를 다시 확인해 주세요.");
  }
  if (!response.ok || !data.ok) throw new Error(data.error?.message || "요청을 처리하지 못했습니다.");
  return data;
}

export default function AdminApp() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [selectedDate, setSelectedDate] = useState(dateKey());
  const [data, setData] = useState<{ reservations: ReservationRow[]; themes: ThemeRow[]; closures: ThemeRow[]; overrides: ThemeRow[]; settings: SettingsRow }>({ reservations: [], themes: [], closures: [], overrides: [], settings: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [reservationModal, setReservationModal] = useState<ReservationRow | "new" | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const result = await api(`/api/admin/dashboard?from=${selectedDate}&to=${selectedDate}`); setData(result); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "불러오지 못했습니다."); }
    finally { setLoading(false); }
  }, [selectedDate]);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2600); };
  const lockAdmin = async () => {
    try { await api("/api/admin/session", { method: "DELETE" }); }
    catch {}
    finally {
      clearAdminSessionToken();
      if (usesRemoteApi()) window.dispatchEvent(new Event("catharsis-admin-session-expired"));
      else window.location.replace("/admin");
    }
  };
  const activeReservations = data.reservations.filter((item) => (item.status === "confirmed" || item.status === "checked_in") && !["ready", "confirming"].includes(String(item.payment_status)));
  const guestTotal = activeReservations.reduce((sum, item) => sum + Number(item.party_size), 0);

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <a className="admin-logo" href={publicSiteUrl()}><span>C</span><div><strong>카타르시스</strong><small>예약·운영 관리</small></div></a>
        <nav>{(Object.keys(tabNames) as Tab[]).map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}><NavIcon type={item} />{tabNames[item]}</button>)}</nav>
        <div className="admin-user"><span>관</span><div><strong>운영 관리자</strong><small>예약·운영 관리</small></div></div>
      </aside>

      <section className="admin-workspace">
        <header className="admin-topbar"><div><p>카타르시스 이스케이프</p><h1>{tabNames[tab]}</h1></div><div className="admin-top-actions"><a href={publicSiteUrl()} target="_blank">공개 사이트 보기</a><button type="button" onClick={lockAdmin}>관리 화면 잠그기</button></div></header>
        {error && <div className="admin-error">{error}<button onClick={load}>다시 시도</button></div>}
        {loading && data.themes.length === 0 ? <AdminLoading /> : <>
          {tab === "dashboard" && <Dashboard date={selectedDate} setDate={setSelectedDate} reservations={data.reservations} guestTotal={guestTotal} onNew={() => setReservationModal("new")} onOpen={setReservationModal} />}
          {tab === "reservations" && <Reservations date={selectedDate} setDate={setSelectedDate} reservations={data.reservations} themes={data.themes} onNew={() => setReservationModal("new")} onOpen={setReservationModal} />}
          {tab === "schedule" && <Schedule themes={data.themes} overrides={data.overrides} date={selectedDate} setDate={setSelectedDate} onSaved={() => { notify("운영 일정을 반영했습니다."); load(); }} />}
          {tab === "themes" && <Themes themes={data.themes} onSaved={() => { notify("테마 정보를 저장했습니다."); load(); }} />}
          {tab === "closures" && <Closures themes={data.themes} closures={data.closures} onSaved={() => { notify("휴무 일정을 반영했습니다."); load(); }} />}
          {tab === "settings" && <Settings settings={data.settings} onSaved={() => { notify("예약 설정을 저장했습니다."); load(); }} />}
        </>}
      </section>
      <nav className="admin-mobile-nav">{(["dashboard", "reservations", "schedule", "themes", "closures", "settings"] as Tab[]).map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}><NavIcon type={item} /><span>{tabNames[item]}</span></button>)}</nav>
      {reservationModal && <ReservationEditor value={reservationModal} themes={data.themes} date={selectedDate} onClose={() => setReservationModal(null)} onSaved={() => { setReservationModal(null); notify("예약 정보를 저장했습니다."); load(); }} />}
      {toast && <div className="admin-toast">✓ {toast}</div>}
    </main>
  );
}

function NavIcon({ type }: { type: Tab }) {
  const paths: Record<Tab, string> = { dashboard: "M4 13h6V4H4v9Zm10 7h6v-9h-6v9ZM4 20h6v-3H4v3Zm10-13h6V4h-6v3Z", reservations: "M7 3v3m10-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z", schedule: "M4 7h16M7 4v6m10-6v6M5 11h14v9H5z", themes: "M4 18 14 4l6 6-10 10H4v-2Zm9-11 4 4", closures: "M5 5l14 14M19 5 5 19", settings: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm0-12v2m0 13v2m8.5-8.5h-2m-13 0h-2m14.5-6.5-1.4 1.4M7.4 16.6 6 18m12 0-1.4-1.4M7.4 7.4 6 6" };
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[type]} /></svg>;
}

function DateToolbar({ date, setDate }: { date: string; setDate: (value: string) => void }) {
  const move = (amount: number) => { const next = new Date(`${date}T12:00:00+09:00`); next.setDate(next.getDate() + amount); setDate(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(next)); };
  return <div className="date-toolbar"><button onClick={() => move(-1)} aria-label="이전 날짜">‹</button><div><strong>{displayDate(date)}</strong><button onClick={() => setDate(dateKey())}>오늘</button></div><button onClick={() => move(1)} aria-label="다음 날짜">›</button></div>;
}

function Dashboard({ date, setDate, reservations, guestTotal, onNew, onOpen }: { date: string; setDate: (value: string) => void; reservations: ReservationRow[]; guestTotal: number; onNew: () => void; onOpen: (value: ReservationRow) => void }) {
  const active = reservations.filter((item) => (item.status === "confirmed" || item.status === "checked_in") && !["ready", "confirming"].includes(String(item.payment_status)));
  return <div className="admin-content"><div className="admin-heading-row"><DateToolbar date={date} setDate={setDate} /><button className="admin-primary" onClick={onNew}>＋ 예약 직접 추가</button></div><div className="metric-grid"><Metric label="예약" value={`${active.length}건`} note="확정·입장 상태" /><Metric label="방문 인원" value={`${guestTotal}명`} note="선택 날짜 기준" /><Metric label="취소 예약" value={`${reservations.filter((item) => item.status === "cancelled").length}건`} note="선택 날짜 기준" /><Metric label="예약 테마" value={`${new Set(active.map((item) => item.theme_id)).size}개`} note="예약이 있는 테마" /></div><section className="admin-panel"><div className="panel-title"><div><h2>예약 일정</h2></div><span>{active.length ? `${minuteToTime(active[0]?.start_minute)}부터` : "예정된 예약 없음"}</span></div><ReservationList reservations={reservations} onOpen={onOpen} /></section></div>;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) { return <article className="metric-card"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>; }

function Reservations({ date, setDate, reservations, themes, onNew, onOpen }: { date: string; setDate: (value: string) => void; reservations: ReservationRow[]; themes: ThemeRow[]; onNew: () => void; onOpen: (value: ReservationRow) => void }) {
  const [query, setQuery] = useState(""); const [status, setStatus] = useState("all"); const [theme, setTheme] = useState("all");
  const filtered = reservations.filter((item) => (status === "all" || item.status === status) && (theme === "all" || item.theme_id === theme) && (!query || String(item.customer_name).includes(query) || String(item.phone).replace(/\D/g, "").endsWith(query.replace(/\D/g, ""))));
  return <div className="admin-content"><div className="admin-heading-row"><DateToolbar date={date} setDate={setDate} /><button className="admin-primary" onClick={onNew}>＋ 예약 직접 추가</button></div><div className="reservation-filters"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="이름 또는 전화번호 뒤 4자리" /><select value={theme} onChange={(event) => setTheme(event.target.value)}><option value="all">전체 테마</option>{themes.map((item) => <option key={String(item.id)} value={String(item.id)}>{String(item.short_name)}</option>)}</select><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">전체 상태</option><option value="confirmed">예약 확정</option><option value="cancelled">취소</option><option value="completed">이용 완료</option><option value="no_show">미방문</option></select></div><section className="admin-panel"><ReservationList reservations={filtered} onOpen={onOpen} /></section></div>;
}

function ReservationList({ reservations, onOpen }: { reservations: ReservationRow[]; onOpen: (value: ReservationRow) => void }) {
  if (!reservations.length) return <div className="empty-state"><strong>예약이 없습니다.</strong><p>선택한 날짜와 조건에 해당하는 예약이 없습니다.</p></div>;
  return <div className="reservation-list"><div className="reservation-head"><span>시간</span><span>테마</span><span>예약자</span><span>인원</span><span>연락처</span><span>상태</span></div>{reservations.map((item) => <button key={String(item.id)} className="reservation-row" onClick={() => onOpen(item)}><strong>{minuteToTime(item.start_minute)}</strong><span>{String(item.theme_name_snapshot)}</span><span>{String(item.customer_name)}</span><span>{String(item.party_size)}명</span><span>{String(item.phone).replace(/(\d{3})-(\d{4})-(\d{4})/, "$1-****-$3")}</span><em className={`status ${String(item.payment_status || item.status)}`}>{reservationStatusLabel(item)}</em></button>)}</div>;
}

function ReservationEditor({ value, themes, date, onClose, onSaved }: { value: ReservationRow | "new"; themes: ThemeRow[]; date: string; onClose: () => void; onSaved: () => void }) {
  const current = value === "new" ? null : value;
  const [form, setForm] = useState({ id: String(current?.id || ""), themeId: String(current?.theme_id || themes[0]?.id || ""), date: String(current?.service_date || date), time: current ? minuteToTime(current.start_minute) : "10:30", partySize: Number(current?.party_size || 2), name: String(current?.customer_name || ""), phone: String(current?.phone || ""), status: String(current?.status || "confirmed"), memo: String(current?.admin_memo || "") });
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const currentPayment = String(current?.payment_status || "manual");
  const paymentLocked = ["confirming", "review_required", "refund_processing"].includes(currentPayment);
  const saveBlocked = paymentLocked || (["ready", "failed", "expired", "refunded"].includes(currentPayment) && form.status !== "cancelled");
  const save = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setError(""); try { await api("/api/admin/reservations", { method: current ? "PATCH" : "POST", body: JSON.stringify(form) }); onSaved(); } catch (caught) { setError(caught instanceof Error ? caught.message : "저장하지 못했습니다."); } finally { setSaving(false); } };
  const reconcile = async () => { if (!current) return; setSaving(true); setError(""); try { await api("/api/admin/payments/reconcile", { method: "POST", body: JSON.stringify({ id: current.id, action: "recheck" }) }); onSaved(); } catch (caught) { setError(caught instanceof Error ? caught.message : "결제 상태를 확인하지 못했습니다."); } finally { setSaving(false); } };
  const release = async () => { if (!current || !confirm("토스 상점관리자에서 실제 결제 내역이 없는 것을 확인하셨습니까?")) return; if (!confirm("미결제 예약을 해제하면 해당 시간이 다시 예약 가능해집니다. 계속하시겠습니까?")) return; setSaving(true); setError(""); try { await api("/api/admin/payments/reconcile", { method: "POST", body: JSON.stringify({ id: current.id, action: "release" }) }); onSaved(); } catch (caught) { setError(caught instanceof Error ? caught.message : "미결제 예약을 해제하지 못했습니다."); } finally { setSaving(false); } };
  const paymentNotice = paymentLocked ? <><span>결제 또는 환불 상태 확인 중에는 예약 정보를 변경할 수 없습니다.</span><div><button type="button" onClick={reconcile} disabled={saving}>결제 상태 다시 확인</button>{currentPayment === "review_required" && <button type="button" onClick={release} disabled={saving}>미결제 예약 해제</button>}</div></> : currentPayment === "ready" ? "고객이 결제를 진행 중입니다. 필요한 경우 예약 취소만 할 수 있습니다." : "";
  return <div className="admin-modal-backdrop" onMouseDown={onClose}><form className="admin-modal" onSubmit={save} onMouseDown={(event) => event.stopPropagation()}><button type="button" className="admin-modal-close" onClick={onClose}>×</button>{current && <p className="eyebrow">{String(current.booking_code)}</p>}<h2>{current ? "예약 상세" : "예약 직접 추가"}</h2>{current && <div className="admin-payment-summary"><span>{reservationStatusLabel(current)}</span><strong>{Number(current.paid_amount || current.price_total || 0).toLocaleString("ko-KR")}원</strong><small>{String(current.payment_method || (current.payment_status === "manual" ? "관리자 직접 등록" : "카드결제"))}</small></div>}{paymentNotice && <div className="admin-state-notice">{paymentNotice}</div>}<div className="admin-form-grid"><label>테마<select value={form.themeId} onChange={(event) => setForm({ ...form, themeId: event.target.value })} disabled={Boolean(current)}>{themes.filter((item) => item.status !== "archived").map((item) => <option key={String(item.id)} value={String(item.id)}>{String(item.name)}</option>)}</select></label><label>날짜<input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} disabled={Boolean(current)} /></label><label>시간<input type="time" value={form.time} onChange={(event) => setForm({ ...form, time: event.target.value })} disabled={Boolean(current)} /></label><label>인원<input type="number" min="1" max="30" value={form.partySize} onChange={(event) => setForm({ ...form, partySize: Number(event.target.value) })} /></label><label>대표자 이름<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>전화번호<input type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>{current && <label>상태<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })} disabled={paymentLocked}><option value="confirmed">예약 확정</option><option value="checked_in">입장</option><option value="completed">이용 완료</option><option value="cancelled">예약 취소·환불</option><option value="no_show">미방문</option></select></label>}<label className="full">관리자 메모<textarea value={form.memo} onChange={(event) => setForm({ ...form, memo: event.target.value })} placeholder="직원끼리 확인할 내용을 입력하세요." /></label></div>{error && <div className="admin-form-error">{error}</div>}<div className="admin-modal-actions"><button type="button" className="admin-secondary" onClick={onClose}>닫기</button><button className="admin-primary" disabled={saving || saveBlocked}>{saving ? "저장 중…" : current ? "변경사항 저장" : "예약 등록"}</button></div></form></div>;
}

function AdminLoading() { return <div className="admin-loading"><span /><span /><span /></div>; }

function Schedule({ themes, overrides, date, setDate, onSaved }: { themes: ThemeRow[]; overrides: ThemeRow[]; date: string; setDate: (value: string) => void; onSaved: () => void }) {
  const activeThemes = themes.filter((item) => item.status !== "archived");
  const [themeId, setThemeId] = useState(String(activeThemes[0]?.id || ""));
  const [week, setWeek] = useState<Record<string, string[]>>({ "0": [], "1": [], "2": [], "3": [], "4": [], "5": [], "6": [] });
  const [newTimes, setNewTimes] = useState<Record<string, string>>({});
  const [exception, setException] = useState({ action: "block", time: "10:30", durationMin: 60, note: "" });
  const [loading, setLoading] = useState(false); const [saving, setSaving] = useState(false); const [exceptionSaving, setExceptionSaving] = useState(false); const [error, setError] = useState("");
  const days = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
  const load = useCallback(async () => { if (!themeId) return; setLoading(true); try { const result = await api(`/api/admin/schedule?themeId=${themeId}`); const next: Record<string, string[]> = { "0": [], "1": [], "2": [], "3": [], "4": [], "5": [], "6": [] }; for (const rule of result.rules as Record<string, unknown>[]) next[String(rule.weekday)].push(minuteToTime(rule.start_minute)); setWeek(next); } catch (caught) { setError(caught instanceof Error ? caught.message : "불러오지 못했습니다."); } finally { setLoading(false); } }, [themeId, setWeek]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  const add = (day: number) => { const time = newTimes[String(day)] || "10:30"; if (week[String(day)].includes(time)) return; setWeek({ ...week, [String(day)]: [...week[String(day)], time].sort() }); };
  const copyAll = (source: number) => { const times = [...week[String(source)]]; setWeek(Object.fromEntries(Array.from({ length: 7 }, (_, day) => [String(day), [...times]]))); };
  const save = async () => { setSaving(true); setError(""); try { await api("/api/admin/schedule", { method: "PUT", body: JSON.stringify({ themeId, week }) }); onSaved(); } catch (caught) { setError(caught instanceof Error ? caught.message : "저장하지 못했습니다."); } finally { setSaving(false); } };
  const currentOverrides = overrides.filter((item) => item.theme_id === themeId && item.service_date === date);
  const saveException = async (event: FormEvent) => {
    event.preventDefault(); setExceptionSaving(true); setError("");
    try {
      await api("/api/admin/overrides", { method: "POST", body: JSON.stringify({ themeId, date, time: exception.time, action: exception.action, durationMin: exception.action === "add" ? exception.durationMin : undefined, note: exception.note }) });
      setException({ ...exception, note: "" }); onSaved();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "예외 시간을 적용하지 못했습니다."); }
    finally { setExceptionSaving(false); }
  };
  const removeException = async (id: unknown) => {
    if (!confirm("이 날짜의 시간 변경을 되돌리시겠습니까?")) return;
    setError("");
    try { await api(`/api/admin/overrides?id=${encodeURIComponent(String(id))}`, { method: "DELETE" }); onSaved(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "시간 변경을 해제하지 못했습니다."); }
  };
  return <div className="admin-content"><div className="admin-heading-row"><div className="context-select"><span>테마</span><select value={themeId} onChange={(event) => setThemeId(event.target.value)}>{activeThemes.map((item) => <option key={String(item.id)} value={String(item.id)}>{String(item.name)}</option>)}</select></div><button className="admin-primary" onClick={save} disabled={saving}>{saving ? "저장 중…" : "운영 시간 저장"}</button></div>{error && <div className="admin-form-error">{error}</div>}<section className="admin-panel schedule-panel"><div className="panel-title"><div><h2>기본 운영표</h2></div><span>요일별 반복 운영 시간</span></div>{loading ? <AdminLoading /> : <div className="week-list">{days.map((day, index) => <div className="week-row" key={day}><div className="week-name"><strong>{day}</strong><span>{week[String(index)].length ? `${week[String(index)].length}회 운영` : "휴무"}</span></div><div className="time-chips">{week[String(index)].map((time) => <button key={time} onClick={() => setWeek({ ...week, [String(index)]: week[String(index)].filter((value) => value !== time) })}>{time}<span>×</span></button>)}<div className="add-time"><input type="time" value={newTimes[String(index)] || "10:30"} onChange={(event) => setNewTimes({ ...newTimes, [String(index)]: event.target.value })} /><button onClick={() => add(index)}>＋ 시간 추가</button></div></div>{index === 1 && <button className="copy-week" onClick={() => copyAll(index)}>전체 요일에 적용</button>}</div>)}</div>}</section><section className="admin-panel exception-panel"><div className="panel-title"><div><h2>특정 날짜 시간 변경</h2></div><span>추가 시간과 마감 시간을 관리합니다.</span></div><div className="exception-layout"><form className="exception-form" onSubmit={saveException}><label>적용 날짜<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label>처리<select value={exception.action} onChange={(event) => setException({ ...exception, action: event.target.value })}><option value="block">예약 마감</option><option value="add">시간 추가</option></select></label><label>시작 시간<input type="time" value={exception.time} onChange={(event) => setException({ ...exception, time: event.target.value })} /></label>{exception.action === "add" && <label>진행 시간<input type="number" min="30" max="180" step="5" value={exception.durationMin} onChange={(event) => setException({ ...exception, durationMin: Number(event.target.value) })} /></label>}<label className="wide">내부 메모<input value={exception.note} maxLength={120} onChange={(event) => setException({ ...exception, note: event.target.value })} placeholder="예: 단체 예약, 장비 점검" /></label><button className="admin-primary" disabled={exceptionSaving}>{exceptionSaving ? "적용 중…" : exception.action === "add" ? "시간 추가" : "예약 마감"}</button></form><div className="exception-list"><div className="exception-date"><strong>{displayDate(date)}</strong><span>{currentOverrides.length}건의 변경</span></div>{currentOverrides.length ? currentOverrides.map((item) => <article key={String(item.id)}><div className={`exception-badge ${String(item.action)}`}>{item.action === "add" ? "추가" : "마감"}</div><div><strong>{minuteToTime(item.start_minute)}</strong><p>{String(item.note || (item.action === "add" ? "추가 운영 시간" : "예약 마감"))}</p></div><button type="button" onClick={() => removeException(item.id)}>되돌리기</button></article>) : <div className="exception-empty"><strong>기본 운영표 적용</strong><p>이 날짜에 별도 변경된 시간이 없습니다.</p></div>}</div></div></section></div>;
}

const blankTheme = { id: "", slug: "", name: "", short_name: "", genre: "", synopsis: "", art_key: "life", difficulty: 3, difficulty_label: "", duration_min: 60, turnover_min: 30, min_people: 2, max_people: 5, notice: "", prices_json: "{\"2\":44000,\"3\":60000,\"4\":72000,\"5\":90000}", status: "hidden", display_order: 99 };

function Themes({ themes, onSaved }: { themes: ThemeRow[]; onSaved: () => void }) {
  const [editing, setEditing] = useState<ThemeRow | null>(null);
  return <div className="admin-content"><div className="admin-heading-row"><div className="admin-section-copy"><h2>테마 목록</h2></div><button className="admin-primary" onClick={() => setEditing({ ...blankTheme })}>＋ 새 테마 추가</button></div><div className="theme-admin-grid">{themes.filter((item) => item.status !== "archived").map((item) => <article className="theme-admin-card" key={String(item.id)}><div className={`theme-admin-art ${String(item.art_key)} ${item.image_key ? "has-image" : ""}`} style={item.image_key ? { backgroundImage: `url(${themeImageUrl(String(item.image_key))})` } : undefined}>{!item.image_key && <ThemePosterArt artKey={String(item.art_key)} title={String(item.short_name)} />}<span className={`visibility ${String(item.status)}`}>{item.status === "active" ? "공개" : "숨김"}</span></div><div><p>{String(item.genre)}</p><h3>{String(item.name)}</h3><dl><div><dt>난이도</dt><dd>{String(item.difficulty)} / 5</dd></div><div><dt>진행</dt><dd>{String(item.duration_min)}분</dd></div><div><dt>인원</dt><dd>{String(item.min_people)}–{String(item.max_people)}인</dd></div></dl><button onClick={() => setEditing(item)}>테마 수정</button></div></article>)}</div>{editing && <ThemeEditor value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onSaved(); }} />}</div>;
}

function ThemeEditor({ value, onClose, onSaved }: { value: ThemeRow; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ id: String(value.id || ""), slug: String(value.slug || ""), name: String(value.name || ""), shortName: String(value.short_name || ""), genre: String(value.genre || ""), synopsis: String(value.synopsis || ""), artKey: String(value.art_key || "life"), imageKey: value.image_key ? String(value.image_key) : "", difficulty: Number(value.difficulty || 3), difficultyLabel: String(value.difficulty_label || ""), durationMin: Number(value.duration_min || 60), turnoverMin: Number(value.turnover_min || 30), minPeople: Number(value.min_people || 2), maxPeople: Number(value.max_people || 5), notice: String(value.notice || ""), prices: (() => { try { return JSON.parse(String(value.prices_json || "{}")); } catch { return {}; } })(), status: String(value.status || "hidden"), displayOrder: Number(value.display_order || 0) });
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const set = (key: string, next: unknown) => setForm({ ...form, [key]: next });
  const save = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setError(""); try { await api("/api/admin/themes", { method: value.id ? "PUT" : "POST", body: JSON.stringify(form) }); onSaved(); } catch (caught) { setError(caught instanceof Error ? caught.message : "저장하지 못했습니다."); } finally { setSaving(false); } };
  const archive = async () => { if (!value.id || !confirm("이 테마를 운영 종료하시겠습니까? 예약 기록은 보존됩니다.")) return; setSaving(true); try { await api(`/api/admin/themes?id=${value.id}`, { method: "DELETE" }); onSaved(); } catch (caught) { setError(caught instanceof Error ? caught.message : "삭제하지 못했습니다."); } finally { setSaving(false); } };
  const upload = async (file?: File) => { if (!file) return; setSaving(true); setError(""); try { const data = new FormData(); data.set("file", file); const response = await fetch(apiUrl("/api/admin/theme-image"), { method: "POST", credentials: usesRemoteApi() ? "omit" : "same-origin", headers: adminRequestHeaders({ "X-Catharsis-Admin-Request": "1" }), body: data }); const result = await response.json(); if (response.status === 401) { notifyAdminSessionExpired(); throw new Error("관리자 키를 다시 확인해 주세요."); } if (!response.ok) throw new Error(result.error?.message); set("imageKey", result.key); } catch (caught) { setError(caught instanceof Error ? caught.message : "업로드하지 못했습니다."); } finally { setSaving(false); } };
  return <div className="admin-modal-backdrop" onMouseDown={onClose}><form className="admin-modal theme-editor" onSubmit={save} onMouseDown={(event) => event.stopPropagation()}><button type="button" className="admin-modal-close" onClick={onClose}>×</button><h2>{value.id ? "테마 수정" : "새 테마 추가"}</h2><div className="theme-editor-layout"><div className="admin-form-grid"><label className="full">공개 상태<select value={form.status} onChange={(event) => set("status", event.target.value)}><option value="active">공개</option><option value="hidden">숨김</option></select></label><label className="full">테마명<input value={form.name} onChange={(event) => set("name", event.target.value)} /></label><label>예약용 짧은 이름<input value={form.shortName} onChange={(event) => set("shortName", event.target.value)} /></label><label>장르<input value={form.genre} onChange={(event) => set("genre", event.target.value)} /></label><label className="full">줄거리<textarea value={form.synopsis} onChange={(event) => set("synopsis", event.target.value)} /></label><label>기본 포스터<select value={form.artKey} onChange={(event) => set("artKey", event.target.value)}><option value="life">원형 포스터</option><option value="office">격자 포스터</option><option value="knock">잠입 포스터</option></select></label><label>대표 이미지 업로드<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => upload(event.target.files?.[0])} /></label><label>난이도<input type="number" min="1" max="5" value={form.difficulty} onChange={(event) => set("difficulty", Number(event.target.value))} /></label><label>진행 시간<input type="number" min="30" max="180" value={form.durationMin} onChange={(event) => set("durationMin", Number(event.target.value))} /></label><label>정리 시간<input type="number" min="0" max="180" value={form.turnoverMin} onChange={(event) => set("turnoverMin", Number(event.target.value))} /></label><label>최소 인원<input type="number" min="1" max="20" value={form.minPeople} onChange={(event) => set("minPeople", Number(event.target.value))} /></label><label>최대 인원<input type="number" min="1" max="30" value={form.maxPeople} onChange={(event) => set("maxPeople", Number(event.target.value))} /></label><label className="full">주의사항<input value={form.notice} onChange={(event) => set("notice", event.target.value)} /></label><div className="full price-editor"><span>인원별 팀 요금</span>{Array.from({ length: Math.max(0, form.maxPeople - form.minPeople + 1) }, (_, index) => form.minPeople + index).map((people) => <label key={people}>{people}인<input type="number" step="1000" value={form.prices[String(people)] || 0} onChange={(event) => set("prices", { ...form.prices, [String(people)]: Number(event.target.value) })} /></label>)}</div></div><div className="theme-editor-card"><span>고객 화면 미리보기</span><div className={`theme-editor-art ${form.artKey} ${form.imageKey ? "has-image" : ""}`} style={form.imageKey ? { backgroundImage: `url(${themeImageUrl(form.imageKey)})` } : undefined}>{!form.imageKey && <ThemePosterArt artKey={form.artKey} title={form.shortName || form.name || "테마"} />}</div><p>{form.genre || "장르"} · {form.durationMin}분</p><h3>{form.name || "테마명"}</h3><div className="editor-difficulty">{Array.from({ length: 5 }, (_, index) => <i className={index < form.difficulty ? "on" : ""} key={index} />)}</div><small>{form.minPeople}–{form.maxPeople}인</small></div></div>{error && <div className="admin-form-error">{error}</div>}<div className="admin-modal-actions">{value.id && <button type="button" className="admin-danger-link" onClick={archive}>운영 종료</button>}<button type="button" className="admin-secondary" onClick={onClose}>취소</button><button className="admin-primary" disabled={saving}>{saving ? "저장 중…" : value.id ? "변경사항 저장" : "테마 등록"}</button></div></form></div>;
}

function Closures({ themes, closures, onSaved }: { themes: ThemeRow[]; closures: ThemeRow[]; onSaved: () => void }) {
  const [form, setForm] = useState({ scope: "store", themeId: String(themes[0]?.id || ""), startDate: dateKey(1), endDate: dateKey(1), note: "", publicMessage: "휴무" });
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const save = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setError(""); try { await api("/api/admin/closures", { method: "POST", body: JSON.stringify(form) }); setForm({ ...form, note: "", publicMessage: "휴무" }); onSaved(); } catch (caught) { setError(caught instanceof Error ? caught.message : "등록하지 못했습니다."); } finally { setSaving(false); } };
  const remove = async (id: unknown) => { if (!confirm("이 휴무 일정을 해제하시겠습니까?")) return; try { await api(`/api/admin/closures?id=${id}`, { method: "DELETE" }); onSaved(); } catch (caught) { setError(caught instanceof Error ? caught.message : "해제하지 못했습니다."); } };
  return <div className="admin-content closures-layout"><form className="admin-panel closure-form" onSubmit={save}><div className="panel-title"><div><h2>휴무 등록</h2></div></div><div className="admin-form-grid"><label className="full">대상<select value={form.scope} onChange={(event) => setForm({ ...form, scope: event.target.value })}><option value="store">매장 전체</option><option value="theme">특정 테마</option></select></label>{form.scope === "theme" && <label className="full">테마<select value={form.themeId} onChange={(event) => setForm({ ...form, themeId: event.target.value })}>{themes.filter((item) => item.status !== "archived").map((item) => <option value={String(item.id)} key={String(item.id)}>{String(item.name)}</option>)}</select></label>}<label>시작일<input type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></label><label>종료일<input type="date" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} /></label><label className="full">내부 메모<input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="예: 정기 점검" /></label><label className="full">고객 안내 문구<input value={form.publicMessage} onChange={(event) => setForm({ ...form, publicMessage: event.target.value })} /></label></div>{error && <div className="admin-form-error">{error}</div>}<button className="admin-primary" disabled={saving}>{saving ? "적용 중…" : "휴무 적용"}</button></form><section className="admin-panel closure-list"><div className="panel-title"><div><h2>예정된 휴무</h2></div><span>{closures.length}건</span></div>{closures.length ? closures.map((item) => <article key={String(item.id)}><div className="closure-date"><strong>{String(item.start_date).slice(5).replace("-", ".")}</strong>{item.start_date !== item.end_date && <span>— {String(item.end_date).slice(5).replace("-", ".")}</span>}</div><div><strong>{item.scope === "store" ? "매장 전체" : themes.find((theme) => theme.id === item.theme_id)?.short_name || "테마"}</strong><p>{String(item.public_message)}</p></div><button onClick={() => remove(item.id)}>해제</button></article>) : <div className="empty-state"><strong>예정된 휴무가 없습니다.</strong></div>}</section></div>;
}

function Settings({ settings, onSaved }: { settings: SettingsRow; onSaved: () => void }) {
  const [form, setForm] = useState({
    horizonDays: Number(settings.horizon_days || 21),
    leadMinutes: Number(settings.lead_minutes || 60),
    cancelCutoffMinutes: Number(settings.cancel_cutoff_minutes || 1440),
    bookingOpen: Number(settings.booking_open ?? 1) === 1,
    pausedMessage: String(settings.paused_message || "현재 예약 접수가 잠시 중단되었습니다."),
    storePhone: String(settings.store_phone || ""),
    businessName: String(settings.business_name || ""),
    representativeName: String(settings.representative_name || ""),
    businessRegistrationNumber: String(settings.business_registration_number || ""),
    mailOrderRegistrationNumber: String(settings.mail_order_registration_number || ""),
    mailOrderRegistrationAuthority: String(settings.mail_order_registration_authority || ""),
    mailOrderRegistrationExempt: Number(settings.mail_order_registration_exempt || 0) === 1,
    businessAddress: String(settings.business_address || ""),
    businessEmail: String(settings.business_email || ""),
    privacyOfficerName: String(settings.privacy_officer_name || ""),
    operationalPiiRetentionDays: Number(settings.operational_pii_retention_days || 90),
    legalRecordRetentionMonths: Number(settings.legal_record_retention_months || 60),
  });
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const save = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setError(""); try { await api("/api/admin/settings", { method: "PUT", body: JSON.stringify(form) }); onSaved(); } catch (caught) { setError(caught instanceof Error ? caught.message : "저장하지 못했습니다."); } finally { setSaving(false); } };
  return <div className="admin-content"><form className="admin-panel settings-form" onSubmit={save}><div className="panel-title"><div><h2>예약 설정</h2></div><button className="admin-primary" disabled={saving}>{saving ? "저장 중…" : "설정 저장"}</button></div><div className="booking-switch"><div><strong>온라인 예약 접수</strong><p>끄면 고객 화면의 모든 예약 시간이 닫힙니다.</p></div><button type="button" className={form.bookingOpen ? "on" : ""} onClick={() => setForm({ ...form, bookingOpen: !form.bookingOpen })} aria-label={form.bookingOpen ? "온라인 예약 접수 끄기" : "온라인 예약 접수 켜기"}><span /></button></div><div className="settings-grid"><h3 className="settings-group-title">예약 운영</h3><label>예약 공개 기간<span>오늘부터 예약 가능한 날짜 범위</span><div className="unit-input"><input type="number" min="1" max="31" value={form.horizonDays} onChange={(event) => setForm({ ...form, horizonDays: Number(event.target.value) })} /><em>일</em></div></label><label>당일 예약 마감<span>게임 시작 전 접수 마감 시간</span><div className="unit-input"><input type="number" min="0" max="1440" step="10" value={form.leadMinutes} onChange={(event) => setForm({ ...form, leadMinutes: Number(event.target.value) })} /><em>분 전</em></div></label><label>고객 취소 마감<span>이 시간이 지나면 매장 문의가 필요합니다.</span><div className="unit-input"><input type="number" min="0" max="10080" step="60" value={form.cancelCutoffMinutes} onChange={(event) => setForm({ ...form, cancelCutoffMinutes: Number(event.target.value) })} /><em>분 전</em></div></label><label>매장 전화번호<span>예약과 취소 안내에 표시됩니다.</span><input type="tel" value={form.storePhone} onChange={(event) => setForm({ ...form, storePhone: event.target.value })} /></label><label className="full">예약 중지 안내 문구<span>예약 접수를 껐을 때 고객에게 표시됩니다.</span><input value={form.pausedMessage} onChange={(event) => setForm({ ...form, pausedMessage: event.target.value })} /></label><h3 className="settings-group-title">사업자 정보</h3><label>상호<input value={form.businessName} onChange={(event) => setForm({ ...form, businessName: event.target.value })} /></label><label>대표자 이름<input value={form.representativeName} onChange={(event) => setForm({ ...form, representativeName: event.target.value })} /></label><label>사업자등록번호<input inputMode="numeric" placeholder="000-00-00000" value={form.businessRegistrationNumber} onChange={(event) => setForm({ ...form, businessRegistrationNumber: event.target.value })} /></label><label>사업자 이메일<input type="email" value={form.businessEmail} onChange={(event) => setForm({ ...form, businessEmail: event.target.value })} /></label><label className="full">사업장 주소<input value={form.businessAddress} onChange={(event) => setForm({ ...form, businessAddress: event.target.value })} /></label><label className="settings-check full"><input type="checkbox" checked={form.mailOrderRegistrationExempt} onChange={(event) => setForm({ ...form, mailOrderRegistrationExempt: event.target.checked })} /> 통신판매업 신고 면제 대상</label><label>통신판매업 신고번호<input disabled={form.mailOrderRegistrationExempt} value={form.mailOrderRegistrationNumber} onChange={(event) => setForm({ ...form, mailOrderRegistrationNumber: event.target.value })} /></label><label>통신판매업 신고기관<input disabled={form.mailOrderRegistrationExempt} value={form.mailOrderRegistrationAuthority} onChange={(event) => setForm({ ...form, mailOrderRegistrationAuthority: event.target.value })} /></label><h3 className="settings-group-title">개인정보 관리</h3><label>개인정보 보호책임자<input value={form.privacyOfficerName} onChange={(event) => setForm({ ...form, privacyOfficerName: event.target.value })} /></label><label>운영용 예약정보 보유기간<span>이용 또는 취소 후 운영 화면에 보관할 기간</span><div className="unit-input"><input type="number" min="30" max="365" value={form.operationalPiiRetentionDays} onChange={(event) => setForm({ ...form, operationalPiiRetentionDays: Number(event.target.value) })} /><em>일</em></div></label><label>법정 거래기록 보유기간<span>전자상거래 관계 법령에 따른 보관기간</span><div className="unit-input"><input type="number" min="60" max="120" value={form.legalRecordRetentionMonths} onChange={(event) => setForm({ ...form, legalRecordRetentionMonths: Number(event.target.value) })} /><em>개월</em></div></label></div>{error && <div className="admin-form-error">{error}</div>}</form></div>;
}
