"use client";

import { useEffect, useState } from "react";
import { apiUrl, themeImageUrl } from "@/lib/client-runtime";
import type { ThemeRecord } from "@/lib/models";

function Arrow() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" /></svg>;
}

export default function DynamicThemes({ initialThemes }: { initialThemes: ThemeRecord[] }) {
  const [themes, setThemes] = useState(initialThemes);
  useEffect(() => {
    fetch(apiUrl("/api/public/bootstrap"), { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => { if (data.ok && Array.isArray(data.themes)) setThemes(data.themes); })
      .catch(() => {});
  }, []);
  const book = (id: string) => {
    window.dispatchEvent(new CustomEvent("select-booking-theme", { detail: id }));
    document.getElementById("booking")?.scrollIntoView({ behavior: "smooth" });
  };
  return (
    <section className="themes-section" id="themes">
      <div className="shell section-heading"><div><h2>테마</h2></div></div>
      <div className="theme-list shell">
        {themes.map((theme) => (
          <article className="theme-card" key={theme.id}>
            <div className={`theme-art ${theme.artKey} ${theme.imageKey ? "has-image" : ""}`} style={theme.imageKey ? { backgroundImage: `url(${themeImageUrl(theme.imageKey)})` } : undefined} role="img" aria-label={`${theme.name} 테마 이미지`} />
            <div className="theme-info"><div className="theme-topline"><span>{theme.genre}</span><span>{theme.durationMin}분</span></div><h3>{theme.name}</h3><p className="synopsis">{theme.synopsis}</p><div className="theme-tags"><span>{theme.minPeople}–{theme.maxPeople}인</span><span>{theme.difficultyLabel || `난이도 ${theme.difficulty}/5`}</span>{theme.notice && <span>{theme.notice}</span>}</div><button className="theme-book" onClick={() => book(theme.id)}>이 테마 예약하기 <Arrow /></button></div>
          </article>
        ))}
      </div>
    </section>
  );
}
