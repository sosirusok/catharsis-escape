"use client";

import { useEffect, useMemo, useState } from "react";
import { apiUrl } from "@/lib/client-runtime";
import type { ThemeRecord } from "@/lib/models";

function Arrow() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" /></svg>;
}

function won(value: number) {
  return `${value.toLocaleString("ko-KR")}원`;
}

export default function DynamicRates({ initialThemes }: { initialThemes: ThemeRecord[] }) {
  const [themes, setThemes] = useState(initialThemes);
  const [themeId, setThemeId] = useState(initialThemes[0]?.id || "");

  useEffect(() => {
    fetch(apiUrl("/api/public/bootstrap"), { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (!data.ok || !Array.isArray(data.themes)) return;
        setThemes(data.themes);
        setThemeId((current) => data.themes.some((theme: ThemeRecord) => theme.id === current) ? current : data.themes[0]?.id || "");
      })
      .catch(() => {});
  }, []);

  const selectedTheme = themes.find((theme) => theme.id === themeId) || themes[0];
  const rateRows = useMemo(() => {
    if (!selectedTheme) return [];
    return Array.from(
      { length: Math.max(0, selectedTheme.maxPeople - selectedTheme.minPeople + 1) },
      (_, index) => selectedTheme.minPeople + index,
    ).map((people) => {
      const total = Number(selectedTheme.prices[String(people)] || 0);
      return { people, total, perPerson: total > 0 ? Math.round(total / people) : 0 };
    });
  }, [selectedTheme]);

  const goBooking = () => {
    if (selectedTheme) window.dispatchEvent(new CustomEvent("select-booking-theme", { detail: selectedTheme.id }));
    document.getElementById("booking")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <section className="rates-section" id="price">
      <div className="shell rates-layout">
        <div className="rates-title">
          <h2>이용 요금</h2>
          <p>테마와 이용 인원에 맞는 요금을 확인해 주세요.</p>
        </div>
        <div className="rates-content">
          <div className="rate-theme-tabs" role="tablist" aria-label="요금을 확인할 테마">
            {themes.map((theme) => (
              <button
                type="button"
                role="tab"
                aria-selected={theme.id === selectedTheme?.id}
                className={theme.id === selectedTheme?.id ? "selected" : ""}
                key={theme.id}
                onClick={() => setThemeId(theme.id)}
              >
                {theme.shortName}
              </button>
            ))}
          </div>

          {selectedTheme && (
            <>
              <div className="rate-theme-summary">
                <div>
                  <span>{selectedTheme.genre}</span>
                  <strong>{selectedTheme.name}</strong>
                </div>
                <p><b>{selectedTheme.durationMin}분</b><span>{selectedTheme.minPeople}–{selectedTheme.maxPeople}인</span></p>
              </div>
              <div className="price-table" role="table" aria-label={`${selectedTheme.name} 인원별 이용요금`}>
                <div className="price-head" role="row">
                  <span role="columnheader">인원</span>
                  <span role="columnheader">1인 요금</span>
                  <span role="columnheader">팀 총액</span>
                </div>
                {rateRows.map((row) => (
                  <div role="row" key={row.people}>
                    <strong role="cell">{row.people}인</strong>
                    <span role="cell">{row.perPerson ? won(row.perPerson) : "매장 문의"}</span>
                    <b role="cell">{row.total ? won(row.total) : "매장 문의"}</b>
                  </div>
                ))}
              </div>
              <div className="rate-footer">
                <p>선택한 인원에 따른 최종 요금은 예약 확인 단계에서 다시 안내됩니다.</p>
                <button type="button" onClick={goBooking}>이 테마 예약하기 <Arrow /></button>
              </div>
            </>
          )}
          <div className="amenities" aria-label="편의시설 및 문의">
            <span>물품보관함</span>
            <span>스마트폰 충전</span>
            <a href="https://talk.naver.com/ct/w4ih5s" target="_blank" rel="noreferrer">
              네이버 톡톡 문의 <Arrow />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
