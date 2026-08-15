import type { BookingSettingsRecord } from "@/lib/models";

export function cancelCutoffLabel(minutes: number): string {
  if (minutes <= 0) return "이용 시작 전";
  if (minutes % 60 === 0) return `이용 시작 ${minutes / 60}시간 전`;
  return `이용 시작 ${minutes}분 전`;
}

export function merchantComplianceMissing(settings: BookingSettingsRecord): string[] {
  const missing: string[] = [];
  if (!settings.businessName.trim()) missing.push("상호명");
  if (!settings.representativeName.trim()) missing.push("대표자명");
  if (!/^\d{3}-\d{2}-\d{5}$/.test(settings.businessRegistrationNumber.trim())) missing.push("사업자등록번호");
  if (!settings.mailOrderRegistrationExempt) {
    if (!settings.mailOrderRegistrationNumber.trim()) missing.push("통신판매업 신고번호");
    if (!settings.mailOrderRegistrationAuthority.trim()) missing.push("통신판매업 신고기관");
  }
  if (!settings.businessAddress.trim()) missing.push("사업장 주소");
  if (!/^0\d{1,2}-?\d{3,4}-?\d{4}$/.test(settings.storePhone.trim())) missing.push("고객센터 전화번호");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.businessEmail.trim())) missing.push("고객센터 이메일");
  if (!settings.privacyOfficerName.trim()) missing.push("개인정보 보호책임자");
  if (!settings.consentVersion.trim()) missing.push("개인정보 처리방침 버전");
  if (!settings.termsVersion.trim()) missing.push("이용약관 버전");
  if (!settings.refundPolicyVersion.trim()) missing.push("취소·환불 정책 버전");
  if (settings.operationalPiiRetentionDays < 30) missing.push("운영 개인정보 보유기간");
  if (settings.legalRecordRetentionMonths < 60) missing.push("법정 거래기록 보유기간");
  return missing;
}

export function policyEffectiveDate(version: string): string {
  const date = version.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date.replaceAll("-", ". ")}.` : version;
}

export function safePaymentReceiptUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2_000) return "";
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const trusted = host === "tosspayments.com" || host.endsWith(".tosspayments.com") || host === "pay.naver.com" || host.endsWith(".pay.naver.com");
    if (url.protocol !== "https:" || !trusted) return "";
    return url.toString();
  } catch {
    return "";
  }
}

export function legalRetentionUntil(approvedAt: string | undefined, months = 60): number {
  const parsed = approvedAt ? Date.parse(approvedAt) : Date.now();
  const base = new Date(Number.isFinite(parsed) ? parsed : Date.now());
  base.setUTCMonth(base.getUTCMonth() + Math.max(60, Math.min(120, Math.floor(months))));
  return base.getTime();
}
