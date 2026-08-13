"use client";

import { FormEvent, useMemo, useState } from "react";

type Theme = {
  id: string;
  name: string;
  short: string;
  genre: string;
  people: string;
  difficulty: string;
  synopsis: string;
  art: string;
  notice?: string;
};

const themes: Theme[] = [
  {
    id: "life",
    name: "당신의 인생테마를 찾아드립니다",
    short: "인생테마",
    genre: "감성 · 스릴러",
    people: "2–5인",
    difficulty: "난이도 3/5",
    synopsis:
      "당신의 기억 속 인생 테마를 재현해 드립니다. 단 한 편을 찾는 특별한 상담이 시작됩니다.",
    art: "life",
    notice: "미성년자 비권장",
  },
  {
    id: "office",
    name: "왠지 출근하기 싫은날",
    short: "출근하기 싫은날",
    genre: "일상 · 코믹",
    people: "2인 이상",
    difficulty: "난이도 4/5",
    synopsis:
      "하… 출근하기 싫다. 익숙한 사무실에서 시작되는, 익숙하지 않은 하루. 유쾌하지만 만만하지 않습니다.",
    art: "office",
  },
  {
    id: "knock",
    name: "똑똑! 계시나요?",
    short: "똑똑! 계시나요?",
    genre: "범죄 · 잠입",
    people: "2인 이상",
    difficulty: "문제 중심",
    synopsis:
      "여기가 그 집 맞아? 그래, 맞다니까. 문이 열리면 계획대로 움직이세요.",
    art: "knock",
  },
];

const slots = [
  "10:30",
  "12:00",
  "13:30",
  "15:00",
  "16:30",
  "18:00",
  "19:30",
  "21:00",
  "22:30",
];

function Arrow() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  );
}

function Pin() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

function Phone() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7.3 3h3l1.5 5-2.2 1.7a15.6 15.6 0 0 0 4.7 4.7l1.7-2.2 5 1.5v3c0 2.2-1.8 4-4 4A14 14 0 0 1 3 7c0-2.2 1.8-4 4.3-4Z" />
    </svg>
  );
}

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length < 4) return digits;
  if (digits.length < 8) {
    return digits.slice(0, 3) + "-" + digits.slice(3);
  }
  return (
    digits.slice(0, 3) +
    "-" +
    digits.slice(3, 7) +
    "-" +
    digits.slice(7)
  );
}

function StoreMap() {
  const [zoom, setZoom] = useState(17);
  const latitude = 35.1547355;
  const longitude = 129.0606628;
  const tileSize = 256;
  const columns = 7;
  const rows = 5;
  const scale = 2 ** zoom;
  const centerX = ((longitude + 180) / 360) * scale;
  const latitudeRad = (latitude * Math.PI) / 180;
  const centerY =
    ((1 - Math.asinh(Math.tan(latitudeRad)) / Math.PI) / 2) * scale;
  const startX = Math.floor(centerX) - 3;
  const startY = Math.floor(centerY) - 2;
  const offsetX = (centerX - startX) * tileSize;
  const offsetY = (centerY - startY) * tileSize;
  const tiles = Array.from({ length: columns * rows }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      key: `${zoom}-${startX + column}-${startY + row}`,
      x: startX + column,
      y: startY + row,
      left: column * tileSize,
      top: row * tileSize,
    };
  });

  return (
    <div className="store-map" aria-label="카타르시스 이스케이프 주변 지도">
      <div
        className="map-tile-grid"
        aria-hidden="true"
        style={{
          left: `calc(50% - ${offsetX}px)`,
          top: `calc(50% - ${offsetY}px)`,
          width: columns * tileSize,
          height: rows * tileSize,
        }}
      >
        {tiles.map((tile) => (
          // Raw map tiles are already optimized raster assets served at a fixed size.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={tile.key}
            src={`https://tile.openstreetmap.org/${zoom}/${tile.x}/${tile.y}.png`}
            alt=""
            width={tileSize}
            height={tileSize}
            draggable={false}
            loading="lazy"
            referrerPolicy="no-referrer"
            style={{ left: tile.left, top: tile.top }}
          />
        ))}
      </div>
      <div className="map-tone" aria-hidden="true" />
      <div className="map-marker" aria-hidden="true">
        <span className="map-pin-dot" />
        <div>
          <strong>카타르시스 이스케이프</strong>
          <span>3층</span>
        </div>
      </div>
      <div className="map-controls" aria-label="지도 확대 및 축소">
        <button
          type="button"
          onClick={() => setZoom((value) => Math.min(18, value + 1))}
          disabled={zoom === 18}
          aria-label="지도 확대"
        >
          ＋
        </button>
        <button
          type="button"
          onClick={() => setZoom((value) => Math.max(15, value - 1))}
          disabled={zoom === 15}
          aria-label="지도 축소"
        >
          −
        </button>
      </div>
      <div className="map-place-card">
        <Pin />
        <div>
          <strong>서면역 2번 출구에서 378m</strong>
          <span>부산진구 중앙대로680번가길 29</span>
        </div>
      </div>
      <a
        className="map-naver-link"
        href="https://map.naver.com/p/entry/place/1626605361"
        target="_blank"
        rel="noreferrer"
      >
        네이버 지도에서 크게 보기 <Arrow />
      </a>
      <a
        className="map-attribution"
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
      >
        © OpenStreetMap contributors
      </a>
    </div>
  );
}

export default function Home() {
  const dates = useMemo(
    () =>
      Array.from({ length: 14 }, (_, index) => {
        const date = new Date();
        date.setHours(12, 0, 0, 0);
        date.setDate(date.getDate() + index);
        return {
          key: date.toISOString().slice(0, 10),
          month: date.getMonth() + 1,
          day: date.getDate(),
          weekday: new Intl.DateTimeFormat("ko-KR", {
            weekday: "short",
          }).format(date),
          label: new Intl.DateTimeFormat("ko-KR", {
            month: "long",
            day: "numeric",
            weekday: "short",
          }).format(date),
        };
      }),
    [],
  );

  const [themeId, setThemeId] = useState("life");
  const [dateKey, setDateKey] = useState(dates[0].key);
  const [time, setTime] = useState("");
  const [people, setPeople] = useState(2);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const selectedTheme =
    themes.find((theme) => theme.id === themeId) ?? themes[0];
  const selectedDate =
    dates.find((date) => date.key === dateKey) ?? dates[0];
  const phoneDigits = phone.replace(/\D/g, "");
  const ready = Boolean(
    themeId &&
      dateKey &&
      time &&
      name.trim() &&
      phoneDigits.length >= 10 &&
      agreed,
  );

  const chooseTheme = (id: string) => {
    setThemeId(id);
    setTime("");
  };

  const goBooking = (id?: string) => {
    if (id) chooseTheme(id);
    document
      .getElementById("booking")
      ?.scrollIntoView({ behavior: "smooth" });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (ready) setSubmitted(true);
  };

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="카타르시스 이스케이프 홈">
          <span className="brand-mark" aria-hidden="true">
            <i>C</i>
          </span>
          <strong>카타르시스 이스케이프</strong>
        </a>
        <nav className="desktop-nav" aria-label="주요 메뉴">
          <a href="#themes">테마</a>
          <a href="#booking">예약</a>
          <a href="#price">요금</a>
          <a href="#location">오시는 길</a>
        </nav>
        <button className="header-book" onClick={() => goBooking()}>
          예약하기 <Arrow />
        </button>
      </header>

      <section className="hero" id="top">
        <div className="hero-grain" aria-hidden="true" />
        <div className="hero-content">
          <p className="hero-store">부산 서면 방탈출 카페</p>
          <h1>
            일상에서 탈출하는
            <br />
            <em>단 60분.</em>
          </h1>
          <p className="hero-copy">
            세 개의 이야기 중 오늘의 테마를 선택하세요.
            <br />
            문이 닫히는 순간, 당신이 이야기의 주인공이 됩니다.
          </p>
          <div className="hero-actions">
            <button className="button primary" onClick={() => goBooking()}>
              예약하기 <Arrow />
            </button>
            <a className="button quiet" href="#themes">
              테마 보기
            </a>
          </div>
        </div>
        <div
          className="hero-visual"
          role="img"
          aria-label="미스터리한 분위기의 방탈출 공간"
        />
        <div className="hero-facts" aria-label="매장 정보">
          <div>
            <span>운영시간</span>
            <strong>매일 10:30–24:00</strong>
          </div>
          <div>
            <span>오시는 길</span>
            <strong>서면역 2번 출구 378m</strong>
          </div>
          <a href="tel:0518023341">
            <span>예약 문의</span>
            <strong>051-802-3341</strong>
          </a>
        </div>
      </section>

      <section className="themes-section" id="themes">
        <div className="shell section-heading">
          <div>
            <h2>테마 안내</h2>
            <p>서로 다른 분위기의 세 가지 이야기를 만나보세요.</p>
          </div>
          <span>모든 테마 60분 진행</span>
        </div>

        <div className="theme-list shell">
          {themes.map((theme) => (
            <article className="theme-card" key={theme.id}>
              <div
                className={"theme-art " + theme.art}
                role="img"
                aria-label={theme.name + " 테마 이미지"}
              />
              <div className="theme-info">
                <div className="theme-topline">
                  <span>{theme.genre}</span>
                  <span>60분</span>
                </div>
                <h3>{theme.name}</h3>
                <p className="synopsis">{theme.synopsis}</p>
                <div className="theme-tags">
                  <span>{theme.people}</span>
                  <span>{theme.difficulty}</span>
                  {theme.notice && <span>{theme.notice}</span>}
                </div>
                <button
                  className="theme-book"
                  onClick={() => goBooking(theme.id)}
                >
                  이 테마 예약하기 <Arrow />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="booking-section" id="booking">
        <aside className="booking-intro">
          <h2>예약하기</h2>
          <p>원하는 테마와 방문 시간을 선택해 주세요.</p>
          <a
            href="https://booking.naver.com/booking/12/bizes/737799"
            target="_blank"
            rel="noreferrer"
          >
            네이버 예약 바로가기 <Arrow />
          </a>
        </aside>

        <form className="booking-form" onSubmit={submit}>
          <fieldset className="form-block">
            <legend>
              <span>1</span> 테마 선택
            </legend>
            <div className="booking-theme-grid">
              {themes.map((theme) => (
                <button
                  type="button"
                  key={theme.id}
                  className={
                    themeId === theme.id
                      ? "booking-theme selected"
                      : "booking-theme"
                  }
                  onClick={() => chooseTheme(theme.id)}
                  aria-pressed={themeId === theme.id}
                >
                  <span className={"booking-thumb " + theme.art} />
                  <span>
                    <small>{theme.genre}</small>
                    <strong>{theme.short}</strong>
                  </span>
                  <i aria-hidden="true" />
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="form-block">
            <legend>
              <span>2</span> 날짜 선택
            </legend>
            <div className="date-scroller">
              {dates.map((date, index) => (
                <button
                  type="button"
                  key={date.key}
                  className={
                    dateKey === date.key
                      ? "date-button selected"
                      : "date-button"
                  }
                  onClick={() => {
                    setDateKey(date.key);
                    setTime("");
                  }}
                  aria-pressed={dateKey === date.key}
                >
                  <small>{index === 0 ? "오늘" : date.weekday}</small>
                  <strong>{date.day}</strong>
                  <span>{date.month}월</span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="form-block">
            <legend>
              <span>3</span> 시간 선택
            </legend>
            <div className="slot-header">
              <strong>{selectedDate.label}</strong>
            </div>
            <div className="time-grid">
              {slots.map((slot) => (
                <button
                  type="button"
                  key={slot}
                  className={
                    time === slot ? "time-button selected" : "time-button"
                  }
                  onClick={() => setTime(slot)}
                  aria-pressed={time === slot}
                >
                  {slot}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="form-block">
            <legend>
              <span>4</span> 예약자 정보
            </legend>
            <div className="guest-grid">
              <div className="field">
                <label htmlFor="people">인원</label>
                <div className="stepper">
                  <button
                    type="button"
                    onClick={() => setPeople(Math.max(2, people - 1))}
                    aria-label="인원 줄이기"
                  >
                    −
                  </button>
                  <output id="people">
                    <strong>{people}</strong>명
                  </output>
                  <button
                    type="button"
                    onClick={() => setPeople(Math.min(5, people + 1))}
                    aria-label="인원 늘리기"
                  >
                    ＋
                  </button>
                </div>
              </div>
              <div className="field">
                <label htmlFor="guest-name">대표자 이름</label>
                <input
                  id="guest-name"
                  value={name}
                  onChange={(event) =>
                    setName(event.target.value.slice(0, 20))
                  }
                  placeholder="이름"
                  autoComplete="name"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="guest-phone">대표자 전화번호</label>
                <input
                  id="guest-phone"
                  type="tel"
                  inputMode="numeric"
                  value={phone}
                  onChange={(event) =>
                    setPhone(formatPhone(event.target.value))
                  }
                  placeholder="010-0000-0000"
                  autoComplete="tel"
                  required
                />
              </div>
            </div>
            <label className="consent">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(event) => setAgreed(event.target.checked)}
              />
              <span aria-hidden="true" />
              개인정보 수집 및 이용에 동의합니다.
            </label>
          </fieldset>

          <div className="booking-summary">
            <div>
              <span>예약 내용</span>
              <strong>{selectedTheme.name}</strong>
              <p>
                {selectedDate.label} {time || "시간 미선택"} · {people}명
              </p>
            </div>
            <button type="submit" disabled={!ready}>
              예약 내용 확인 <Arrow />
            </button>
          </div>
        </form>
      </section>

      <section className="guide-section" id="guide">
        <div className="shell">
          <div className="guide-heading">
            <h2>이용 안내</h2>
            <p>원활한 진행을 위해 시작 10분 전까지 도착해 주세요.</p>
          </div>
          <ol className="steps">
            <li>
              <span>01</span>
              <strong>예약 확인</strong>
              <p>예약한 테마와 시작 시간을 확인해 주세요.</p>
            </li>
            <li>
              <span>02</span>
              <strong>10분 전 도착</strong>
              <p>지각 시 이용 시간이 줄어들 수 있습니다.</p>
            </li>
            <li>
              <span>03</span>
              <strong>이용 방법 안내</strong>
              <p>입장 전 자물쇠와 힌트 사용법을 안내합니다.</p>
            </li>
            <li>
              <span>04</span>
              <strong>60분 플레이</strong>
              <p>팀원과 단서를 연결해 이야기의 결말을 완성하세요.</p>
            </li>
          </ol>
        </div>
      </section>

      <section className="rates-section" id="price">
        <div className="shell rates-layout">
          <div className="rates-title">
            <h2>이용 요금</h2>
            <p>모든 테마의 기본 이용 시간은 60분입니다.</p>
          </div>
          <div>
            <div className="price-table" role="table" aria-label="인원별 이용요금">
              <div className="price-head" role="row">
                <span role="columnheader">인원</span>
                <span role="columnheader">1인 요금</span>
                <span role="columnheader">팀 총액</span>
              </div>
              <div role="row">
                <strong role="cell">2인</strong>
                <span role="cell">22,000원</span>
                <b role="cell">44,000원</b>
              </div>
              <div role="row">
                <strong role="cell">3인</strong>
                <span role="cell">20,000원</span>
                <b role="cell">60,000원</b>
              </div>
              <div role="row">
                <strong role="cell">4인</strong>
                <span role="cell">18,000원</span>
                <b role="cell">72,000원</b>
              </div>
            </div>
            <p className="price-note">
              5인 이상 이용은 매장으로 문의해 주세요.
            </p>
            <div className="amenities" aria-label="편의시설">
              <span>물품보관함</span>
              <span>스마트폰 충전</span>
              <a
                href="https://talk.naver.com/ct/w4ih5s"
                target="_blank"
                rel="noreferrer"
              >
                네이버 톡톡 문의 <Arrow />
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="notice-section shell">
        <div className="notice-title">
          <h2>방문 전 확인해 주세요.</h2>
        </div>
        <div className="notice-grid">
          <article>
            <span>01</span>
            <h3>도착 시간</h3>
            <p>
              게임 시작 10분 전까지 방문해 주세요. 지각 시 이용 시간이
              줄어들 수 있습니다.
            </p>
          </article>
          <article>
            <span>02</span>
            <h3>촬영 및 스포일러</h3>
            <p>
              테마 내부 촬영과 문제·장치·정답의 온라인 공개는 삼가 주세요.
            </p>
          </article>
          <article>
            <span>03</span>
            <h3>예약 변경</h3>
            <p>
              당일 시간 변경은 어렵습니다. 예약 변경은 매장으로 문의해
              주세요.
            </p>
          </article>
          <article>
            <span>04</span>
            <h3>안전한 이용</h3>
            <p>
              음주 후 입장은 제한될 수 있으며 장치에 무리한 힘을 사용하지
              말아 주세요.
            </p>
          </article>
        </div>
      </section>

      <section className="location-section" id="location">
        <StoreMap />
        <div className="location-info">
          <h2>오시는 길</h2>
          <dl>
            <div>
              <dt>주소</dt>
              <dd>부산 부산진구 중앙대로680번가길 29, 3층</dd>
            </div>
            <div>
              <dt>교통</dt>
              <dd>부산 1·2호선 서면역 2번 출구 도보 378m</dd>
            </div>
            <div>
              <dt>운영시간</dt>
              <dd>매일 10:30–24:00</dd>
            </div>
            <div>
              <dt>문의</dt>
              <dd>
                <a href="tel:0518023341">051-802-3341</a>
              </dd>
            </div>
            <div>
              <dt>주차</dt>
              <dd>전용 주차장 및 주차비 지원 없음</dd>
            </div>
          </dl>
          <div className="location-actions">
            <a
              className="button primary"
              href="https://map.naver.com/p/entry/place/1626605361"
              target="_blank"
              rel="noreferrer"
            >
              네이버 지도 <Arrow />
            </a>
            <a className="phone-link" href="tel:0518023341">
              <Phone /> 전화 문의
            </a>
          </div>
        </div>
      </section>

      <section className="faq-section shell">
        <div>
          <h2>자주 묻는 질문</h2>
        </div>
        <div className="faq-list">
          <details>
            <summary>
              방탈출이 처음이어도 참여할 수 있나요?<span>＋</span>
            </summary>
            <p>
              네. 입장 전 자물쇠와 힌트 사용법을 안내해 드립니다. 처음이라면
              난이도와 취향을 확인해 테마를 골라주세요.
            </p>
          </details>
          <details>
            <summary>
              몇 명이 이용하기 좋은가요?<span>＋</span>
            </summary>
            <p>
              모든 테마는 최소 2인부터 이용할 수 있습니다. 테마별 권장 인원은
              예약 전 매장으로 문의해 주세요.
            </p>
          </details>
          <details>
            <summary>
              어떤 편의시설이 있나요?<span>＋</span>
            </summary>
            <p>물품보관함과 스마트폰 충전 시설을 이용할 수 있습니다.</p>
          </details>
          <details>
            <summary>
              예약 변경은 어떻게 하나요?<span>＋</span>
            </summary>
            <p>
              일정 변경이 필요한 경우 이용 전 매장으로 전화해 주세요. 당일
              변경은 예약 상황에 따라 어려울 수 있습니다.
            </p>
          </details>
        </div>
      </section>

      <footer>
        <div className="footer-main">
          <div className="footer-brand">
            <span className="brand-mark" aria-hidden="true">
              <i>C</i>
            </span>
            <div>
              <strong>카타르시스 이스케이프</strong>
              <p>부산 부산진구 중앙대로680번가길 29, 3층</p>
            </div>
          </div>
          <div className="footer-links">
            <a href="#themes">테마</a>
            <a href="#booking">예약</a>
            <a href="tel:0518023341">051-802-3341</a>
            <a
              href="https://booking.naver.com/booking/12/bizes/737799"
              target="_blank"
              rel="noreferrer"
            >
              네이버 예약
            </a>
          </div>
        </div>
        <div className="footer-bottom">
          © 2026 카타르시스 이스케이프
        </div>
      </footer>

      <button className="mobile-book" onClick={() => goBooking()}>
        예약하기 <Arrow />
      </button>

      {submitted && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setSubmitted(false)}
        >
          <section
            className="review-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              className="modal-close"
              onClick={() => setSubmitted(false)}
              aria-label="닫기"
            >
              ×
            </button>
            <h2 id="review-title">예약 내용을 확인해 주세요.</h2>
            <dl>
              <div>
                <dt>테마</dt>
                <dd>{selectedTheme.name}</dd>
              </div>
              <div>
                <dt>일시</dt>
                <dd>
                  {selectedDate.label} {time}
                </dd>
              </div>
              <div>
                <dt>인원</dt>
                <dd>{people}명</dd>
              </div>
              <div>
                <dt>대표자</dt>
                <dd>{name}</dd>
              </div>
              <div>
                <dt>연락처</dt>
                <dd>{phone}</dd>
              </div>
            </dl>
            <p className="booking-next">
              예약 확정은 네이버 예약에서 이어집니다.
            </p>
            <div className="modal-actions">
              <a
                className="button primary"
                href="https://booking.naver.com/booking/12/bizes/737799"
                target="_blank"
                rel="noreferrer"
              >
                네이버에서 예약하기 <Arrow />
              </a>
              <a className="button quiet" href="tel:0518023341">
                전화 문의
              </a>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
