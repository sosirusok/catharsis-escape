"use client";

import { useEffect, useMemo, useState } from "react";
import StoreFooter from "@/app/_components/StoreFooter";
import { apiUrl, publicSiteUrl } from "@/lib/client-runtime";
import { DEFAULT_SETTINGS, type BookingSettingsRecord } from "@/lib/models";

export type PolicyKind = "privacy" | "terms" | "refund";

const INITIAL_POLICY_SETTINGS = { ...DEFAULT_SETTINGS, storePhone: "" };

type PolicySettings = BookingSettingsRecord & {
  mailOrderRegistrationAuthority?: string;
  mailOrderRegistrationExempt?: boolean;
};

function homeLink() {
  return publicSiteUrl() || "/";
}

function effectiveDate(version: string) {
  const date = version.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  return date ? date.replaceAll("-", ". ") + "." : "";
}

function cutoffLabel(minutes: number) {
  if (minutes <= 0) return "이용 시작 전";
  if (minutes % 1440 === 0) return `이용 시작 ${minutes / 1440}일 전`;
  if (minutes % 60 === 0) return `이용 시작 ${minutes / 60}시간 전`;
  return `이용 시작 ${minutes}분 전`;
}

function ContactLine({ settings }: { settings: PolicySettings }) {
  const contacts = [settings.storePhone, settings.businessEmail].filter(Boolean);
  if (!contacts.length) return null;
  return <p className="policy-contact">문의: {contacts.join(" · ")}</p>;
}

function MerchantList({ settings }: { settings: PolicySettings }) {
  const rows = [
    ["상호", settings.businessName],
    ["대표자", settings.representativeName],
    ["사업자등록번호", settings.businessRegistrationNumber],
    ["통신판매업 신고", settings.mailOrderRegistrationExempt ? "신고 면제" : settings.mailOrderRegistrationNumber],
    ["신고기관", settings.mailOrderRegistrationExempt ? "" : settings.mailOrderRegistrationAuthority],
    ["사업장 주소", settings.businessAddress],
    ["전화", settings.storePhone],
    ["이메일", settings.businessEmail],
  ].filter(([, value]) => Boolean(value));
  if (!rows.length) return null;
  return <dl className="policy-merchant">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

function PrivacyPolicy({ settings }: { settings: PolicySettings }) {
  const operationalDays = Math.max(30, Number(settings.operationalPiiRetentionDays || 90));
  const legalMonths = Math.max(60, Number(settings.legalRecordRetentionMonths || 60));
  return (
    <>
      <section><h2>1. 처리하는 개인정보와 이용 목적</h2><p>예약자 이름과 휴대전화번호, 테마, 이용 날짜와 시간, 인원, 예약번호 및 예약 상태를 예약 확인, 시간 배정, 중복 예약 방지, 변경·취소와 현장 이용을 위해 처리합니다. 주문번호, 결제금액, 결제수단, 승인·취소 상태, 승인·취소 일시와 매출전표 주소는 결제 확인, 환불, 오류 처리와 거래내역 확인을 위해 처리합니다.</p><p>접속 일시, IP 주소와 요청 기록은 비정상 접근 방지, 장애 확인과 서비스 보안을 위해 처리할 수 있습니다. 카드번호, CVC, 카드 비밀번호는 토스페이먼츠 결제화면에서 직접 처리되며 매장 서버에 저장되지 않습니다.</p></section>
      <section><h2>2. 보유기간과 파기</h2><p>현장 운영에 사용하는 예약자 이름과 휴대전화번호 등은 이용일 또는 예약 취소 후 {operationalDays}일 동안 보관한 뒤 운영 영역에서 파기합니다. 계약·청약철회와 대금결제·서비스 제공에 관한 거래기록은 관계 법령에 따라 {legalMonths}개월, 소비자 불만·분쟁 처리 기록은 3년, 표시·광고 기록은 6개월 동안 분리하여 보관할 수 있습니다.</p><p>보유기간이 끝난 전자정보는 복구하기 어려운 방법으로 삭제하며, 법령상 보관이 필요한 정보는 해당 목적 외로 이용하지 않습니다.</p></section>
      <section><h2>3. 처리업무의 위탁</h2><ul><li><strong>토스페이먼츠 주식회사</strong>: 카드결제 승인, 매출전표 제공, 결제취소·환불과 부정거래 방지</li><li><strong>Cloudflare, Inc.</strong>: 서버·데이터베이스 운영, 콘텐츠 전송, 접속 보안과 장애 대응</li></ul><p>수탁자가 개인정보를 목적 외로 처리하지 않도록 관계 법령과 계약에 따라 관리합니다.</p></section>
      <section><h2>4. 고객의 권리</h2><p>고객은 자신의 개인정보에 대해 열람, 정정, 삭제, 처리정지와 동의 철회를 요청할 수 있습니다. 법령에 따라 보관해야 하는 예약·결제·환불 기록은 해당 기간 동안 삭제가 제한될 수 있습니다.</p><p>만 14세 미만 고객의 온라인 예약은 법정대리인이 진행해야 합니다.</p></section>
      <section><h2>5. 안전성 확보조치</h2><p>개인정보 전송구간 암호화, 저장정보 보호, 관리자 인증과 접근권한 관리, 비정상 접근 차단, 접속기록 점검과 보안 업데이트를 시행합니다.</p></section>
      <section><h2>6. 개인정보 보호책임자</h2>{settings.privacyOfficerName && <p>개인정보 보호책임자: {settings.privacyOfficerName}</p>}<ContactLine settings={settings} /><p>개인정보 침해 상담은 개인정보침해 신고센터(국번 없이 118) 또는 개인정보분쟁조정위원회(1833-6972)를 이용할 수 있습니다.</p></section>
    </>
  );
}

function TermsPolicy({ settings }: { settings: PolicySettings }) {
  return (
    <>
      <section><h2>제1조 목적</h2><p>이 약관은 {settings.businessName || "카타르시스 이스케이프"}(이하 “매장”)이 제공하는 방탈출 테마 예약, 카드결제, 예약조회와 취소 서비스의 이용조건 및 매장과 고객의 권리·의무를 정합니다.</p></section>
      <section><h2>제2조 예약 신청과 성립</h2><p>고객은 테마, 날짜, 시간, 인원, 예약자 이름과 휴대전화번호를 정확히 입력하고 결제 전에 예약 내용과 최종 결제금액, 취소·환불 조건을 확인해야 합니다. 예약은 토스페이먼츠 카드결제가 최종 승인되고 사이트가 예약번호를 발급한 때 확정됩니다.</p><p>화면에 예약 가능 시간이 표시되어도 다른 고객의 결제가 먼저 완료되면 해당 시간은 마감될 수 있습니다. 결제 전 임시 확보된 시간은 정해진 결제시간 안에 승인이 끝나지 않으면 자동으로 해제됩니다.</p></section>
      <section><h2>제3조 결제와 예약 확인</h2><p>카드결제는 토스페이먼츠를 통해 처리합니다. 결제가 완료되면 결제완료 화면과 예약조회에서 예약번호, 테마, 이용일시, 인원, 결제금액, 상태와 카드 매출전표를 확인할 수 있습니다.</p><p>결제는 승인되었으나 예약번호가 발급되지 않은 경우 매장은 결제 상태를 확인하여 예약을 복구하거나 결제를 취소합니다.</p></section>
      <section><h2>제4조 결제사실 확인 방법</h2><p>문자메시지와 이메일은 별도로 발송하지 않습니다. 고객은 결제완료 화면과 예약조회에서 결제결과와 예약내용을 확인합니다. 별도 통지 생략에 동의하지 않는 경우 온라인 결제를 진행하지 않고 매장에 다른 예약 방법을 문의할 수 있습니다.</p></section>
      <section><h2>제5조 변경·취소·환불</h2><p>예약 변경, 취소와 환불에는 결제할 때 확인한 취소·환불정책이 적용됩니다. 날짜·시간·테마 변경은 기존 예약 취소 후 새 예약으로 처리될 수 있습니다. 카드 환불은 원래 결제수단으로 처리하며 카드사 반영 시점은 결제수단에 따라 달라질 수 있습니다.</p></section>
      <section><h2>제6조 고객의 의무와 현장 이용</h2><p>고객은 본인 또는 적법하게 사용할 권한이 있는 결제수단을 이용해야 하며 다른 사람의 정보나 결제수단을 도용해서는 안 됩니다. 테마 시작 10분 전까지 도착해 주세요. 지각하면 이용 시간이 줄어들거나 진행이 제한될 수 있습니다.</p></section>
      <section><h2>제7조 미성년자</h2><p>미성년자가 법정대리인의 동의 없이 계약한 경우 본인 또는 법정대리인은 관계 법령에 따라 계약을 취소할 수 있습니다. 만 14세 미만 고객의 온라인 예약은 법정대리인이 진행해야 합니다. 테마별 연령 및 보호자 동반 기준이 있는 경우 해당 안내가 우선합니다.</p></section>
      <section><h2>제8조 서비스 중단과 분쟁 해결</h2><p>천재지변, 정전, 통신망 또는 결제기관 장애, 긴급 안전점검으로 서비스가 중단될 수 있습니다. 이미 결제된 서비스를 제공할 수 없는 경우 일정 변경 또는 환불에 필요한 조치를 합니다. 분쟁은 상호 협의를 우선하고, 해결되지 않으면 한국소비자원 피해구제 또는 소비자분쟁조정 절차를 이용할 수 있습니다.</p></section>
      <section><h2>제9조 사업자 정보</h2><MerchantList settings={settings} /></section>
    </>
  );
}

function RefundPolicy({ settings }: { settings: PolicySettings }) {
  const cutoff = cutoffLabel(settings.cancelCutoffMinutes);
  return (
    <>
      <section className="policy-highlight"><h2>환불 기준</h2><p><strong>{cutoff}까지 사이트에서 취소하면 결제금액 전액이 원래 결제수단으로 환불됩니다.</strong></p><p>그 이후에는 온라인 취소가 제한되므로 매장으로 문의해 주세요. 관계 법령에 따른 청약철회 또는 더 유리한 소비자분쟁해결기준이 적용되는 경우 해당 기준을 우선합니다.</p></section>
      <section><h2>1. 고객 사유로 취소하는 경우</h2><p>취소 가능 시간 안에는 예약조회에서 직접 취소할 수 있습니다. 취소 가능 시간이 지난 뒤의 변경·취소, 이용 시작 후 취소와 노쇼는 매장에 문의해 주세요. 구체적인 처리는 서비스 제공 여부와 관계 법령을 확인해 안내합니다.</p></section>
      <section><h2>2. 매장 사유로 이용할 수 없는 경우</h2><p>시설 고장, 운영상 착오 또는 매장의 책임으로 예약한 서비스를 제공할 수 없으면 동일 조건의 다른 일정으로 변경하거나 결제금액을 전액 환불합니다. 관계 법령상 별도 배상기준이 적용되면 해당 기준을 따릅니다.</p></section>
      <section><h2>3. 예약 변경</h2><p>테마, 날짜와 시간 변경은 기존 예약을 취소하고 새로 예약하는 방식으로 처리될 수 있습니다. 기존 예약은 변경을 요청한 시점의 취소 기준이 적용됩니다. 인원 변경은 테마 정원과 결제금액을 확인하기 위해 매장으로 문의해 주세요.</p></section>
      <section><h2>4. 취소 신청과 환불 처리</h2><p>예약조회에서 예약번호와 휴대전화번호를 입력해 신청하거나 아래 연락처로 문의할 수 있습니다. 환불은 원래 사용한 카드결제를 취소하는 방식으로 처리합니다. 매장이 카드취소를 완료한 뒤 카드한도 복원이나 청구내역 반영까지 걸리는 시간은 카드사에 따라 달라질 수 있습니다.</p><ContactLine settings={settings} /></section>
      <section><h2>5. 결제 오류</h2><p>이중결제, 승인금액 오류 또는 결제 후 예약 확정 실패가 확인되면 잘못된 결제를 전액 취소합니다. 결제완료 화면과 예약조회에서 결제금액, 예약 상태와 카드 매출전표를 확인할 수 있습니다.</p></section>
      <section><h2>사업자 및 문의처</h2><MerchantList settings={settings} /></section>
    </>
  );
}

const titles: Record<PolicyKind, string> = {
  privacy: "개인정보 처리방침",
  terms: "이용약관",
  refund: "취소·환불정책",
};

export default function PolicyPage({ kind, initialSettings = INITIAL_POLICY_SETTINGS }: { kind: PolicyKind; initialSettings?: BookingSettingsRecord }) {
  const [settings, setSettings] = useState<PolicySettings>(initialSettings);
  useEffect(() => {
    fetch(apiUrl("/api/public/bootstrap"), { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => { if (data.ok && data.settings) setSettings(data.settings); })
      .catch(() => {});
  }, []);
  const version = kind === "privacy" ? settings.consentVersion : kind === "terms" ? settings.termsVersion : settings.refundPolicyVersion;
  const date = useMemo(() => effectiveDate(version), [version]);

  return (
    <main className="policy-page">
      <header className="policy-header"><a className="brand" href={homeLink()}><span className="brand-mark" aria-hidden="true"><i>C</i></span><strong>카타르시스 이스케이프</strong></a><a href={homeLink()}>홈으로</a></header>
      <article className="policy-document">
        <div className="policy-title"><h1>{titles[kind]}</h1>{date && <p>시행일 {date}</p>}</div>
        {kind === "privacy" ? <PrivacyPolicy settings={settings} /> : kind === "terms" ? <TermsPolicy settings={settings} /> : <RefundPolicy settings={settings} />}
      </article>
      <StoreFooter initialSettings={settings} />
    </main>
  );
}
