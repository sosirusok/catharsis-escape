"use client";

import { useEffect, useState } from "react";
import { apiUrl, publicSiteUrl } from "@/lib/client-runtime";
import type { BookingSettingsRecord } from "@/lib/models";

type StoreSettings = BookingSettingsRecord & {
  mailOrderRegistrationAuthority?: string;
  mailOrderRegistrationExempt?: boolean;
};

function siteLink(path: string) {
  const base = publicSiteUrl().replace(/\/+$/, "");
  return `${base || ""}/${path.replace(/^\/+|\/+$/g, "")}/`;
}

function MerchantDetails({ settings }: { settings: StoreSettings }) {
  const mailOrder = settings.mailOrderRegistrationExempt
    ? "통신판매업 신고 면제"
    : settings.mailOrderRegistrationNumber
      ? `통신판매업 신고 ${settings.mailOrderRegistrationNumber}${settings.mailOrderRegistrationAuthority ? ` · ${settings.mailOrderRegistrationAuthority}` : ""}`
      : "";

  const identity = [
    settings.businessName,
    settings.representativeName ? `대표 ${settings.representativeName}` : "",
    settings.businessRegistrationNumber ? `사업자등록번호 ${settings.businessRegistrationNumber}` : "",
    mailOrder,
  ].filter(Boolean);

  const contact = [
    settings.businessAddress,
    settings.storePhone ? `고객센터 ${settings.storePhone}` : "",
    settings.businessEmail,
  ].filter(Boolean);

  if (!identity.length && !contact.length) return null;
  return (
    <div className="footer-merchant" aria-label="사업자 정보">
      {identity.length > 0 && <p>{identity.map((item, index) => <span key={item}>{index > 0 && " · "}{item}</span>)}</p>}
      {contact.length > 0 && (
        <p>
          {settings.businessAddress && <span>{settings.businessAddress}</span>}
          {settings.storePhone && <span>{settings.businessAddress && " · "}<a href={`tel:${settings.storePhone.replace(/\D/g, "")}`}>고객센터 {settings.storePhone}</a></span>}
          {settings.businessEmail && <span>{(settings.businessAddress || settings.storePhone) && " · "}<a href={`mailto:${settings.businessEmail}`}>{settings.businessEmail}</a></span>}
        </p>
      )}
      <p><span>호스팅서비스 제공자 GitHub, Inc.</span></p>
    </div>
  );
}

export default function StoreFooter({ initialSettings }: { initialSettings: BookingSettingsRecord }) {
  const [settings, setSettings] = useState<StoreSettings>(initialSettings);

  useEffect(() => {
    fetch(apiUrl("/api/public/bootstrap"), { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => { if (data.ok && data.settings) setSettings(data.settings); })
      .catch(() => {});
  }, []);

  return (
    <footer>
      <div className="footer-main">
        <div className="footer-brand">
          <span className="brand-mark" aria-hidden="true"><i>C</i></span>
          <div>
            <strong>카타르시스 이스케이프</strong>
            {settings.businessAddress && <p>{settings.businessAddress}</p>}
          </div>
        </div>
        <nav className="footer-links" aria-label="사이트 안내">
          <a href={siteLink("privacy")}>개인정보 처리방침</a>
          <a href={siteLink("terms")}>이용약관</a>
          <a href={siteLink("refund")}>취소·환불정책</a>
          <button type="button" onClick={() => window.dispatchEvent(new Event("open-booking-manager"))}>예약 조회·취소</button>
        </nav>
      </div>
      <MerchantDetails settings={settings} />
      <div className="footer-bottom">© 2026 카타르시스 이스케이프</div>
    </footer>
  );
}
