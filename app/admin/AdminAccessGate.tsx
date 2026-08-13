"use client";

import { FormEvent, useState } from "react";
import { apiUrl, publicSiteUrl, saveAdminSessionToken, usesRemoteApi } from "@/lib/client-runtime";

export default function AdminAccessGate({ onAuthenticated }: { onAuthenticated?: () => void }) {
  const [accessKey, setAccessKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessKey || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(apiUrl("/api/admin/session"), {
        method: "POST",
        credentials: usesRemoteApi() ? "omit" : "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-Catharsis-Admin-Request": "1",
        },
        body: JSON.stringify({ accessKey }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error?.message || "관리자 키를 확인해 주세요.");
      if (typeof result.sessionToken === "string") saveAdminSessionToken(result.sessionToken);
      if (onAuthenticated) onAuthenticated();
      else window.location.replace("/admin");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "관리자 키를 확인해 주세요.");
      setAccessKey("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="admin-access-page">
      <div className="admin-access-atmosphere" aria-hidden="true" />
      <section className="admin-access-card" aria-labelledby="admin-access-title">
        <span className="admin-access-mark">C</span>
        <p className="admin-access-brand">CATHARSIS ESCAPE</p>
        <h1 id="admin-access-title">예약·운영 관리</h1>
        <p className="admin-access-copy">관리자 키를 입력해 주세요.</p>
        <form onSubmit={submit}>
          <label htmlFor="admin-access-key">관리자 키</label>
          <input
            id="admin-access-key"
            type="password"
            value={accessKey}
            onChange={(event) => setAccessKey(event.target.value)}
            autoComplete="current-password"
            autoFocus
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "admin-access-error" : undefined}
          />
          {error && <p className="admin-access-error" id="admin-access-error" role="alert">{error}</p>}
          <button type="submit" disabled={!accessKey || submitting}>
            {submitting ? "확인 중…" : "관리 화면 열기"}
          </button>
        </form>
        <a href={publicSiteUrl()}>카타르시스 홈페이지</a>
      </section>
    </main>
  );
}
