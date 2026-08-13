"use client";

import { useState } from "react";
import BookingExperience from "@/app/_components/BookingExperience";
import DynamicRates from "@/app/_components/DynamicRates";
import DynamicThemes from "@/app/_components/DynamicThemes";
import { DEFAULT_SETTINGS, DEFAULT_THEMES } from "@/lib/models";

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
  const goBooking = (id?: string) => {
    if (id) window.dispatchEvent(new CustomEvent("select-booking-theme", { detail: id }));
    document
      .getElementById("booking")
      ?.scrollIntoView({ behavior: "smooth" });
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
            <em>단 한 편.</em>
          </h1>
          <p className="hero-copy">
            각기 다른 이야기 중 오늘의 테마를 선택하세요.
            <br />{" "}
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

      <DynamicThemes initialThemes={DEFAULT_THEMES} />

      <BookingExperience initialThemes={DEFAULT_THEMES} initialSettings={DEFAULT_SETTINGS} />

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
              <strong>테마 플레이</strong>
              <p>제한 시간 안에 단서를 연결해 이야기의 결말을 완성하세요.</p>
            </li>
          </ol>
        </div>
      </section>

      <DynamicRates initialThemes={DEFAULT_THEMES} />

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
              테마마다 이용 가능 인원이 다릅니다. 각 테마 안내와 예약 화면에서
              인원 범위를 확인해 주세요.
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
            <button type="button" onClick={() => window.dispatchEvent(new Event("open-booking-manager"))}>예약 조회·취소</button>
            <a href="tel:0518023341">051-802-3341</a>
          </div>
        </div>
        <div className="footer-bottom">
          © 2026 카타르시스 이스케이프
        </div>
      </footer>

      <button className="mobile-book" onClick={() => goBooking()}>
        예약하기 <Arrow />
      </button>

    </main>
  );
}
