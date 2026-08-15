import { audit, requireAdminApi } from "@/lib/admin-api";
import { getD1, json, readJsonBody } from "@/lib/booking";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const auth = await requireAdminApi(request);
  if (auth.response || !auth.admin) return auth.response;
  try {
    const body = await readJsonBody<Record<string, unknown>>(request, 20_000);
    const db = getD1();
    const before = await db.prepare("SELECT * FROM booking_settings WHERE id = 1").first<Record<string, unknown>>();
    if (!before) return json({ ok: false, error: { message: "예약 설정을 찾을 수 없습니다." } }, 404);

    const boundedNumber = (input: unknown, current: unknown, minimum: number, maximum: number, fallback: number) => {
      const parsed = input === undefined ? Number(current) : Number(input);
      const value = Number.isFinite(parsed) ? parsed : fallback;
      return Math.max(minimum, Math.min(maximum, Math.floor(value)));
    };
    const textValue = (input: unknown, current: unknown, maximum: number, fallback = "") => (
      input === undefined ? String(current ?? fallback) : typeof input === "string" ? input.trim().slice(0, maximum) : fallback
    );

    const horizonDays = boundedNumber(body.horizonDays, before.horizon_days, 1, 31, 21);
    const leadMinutes = boundedNumber(body.leadMinutes, before.lead_minutes, 0, 1440, 60);
    const cancelCutoffMinutes = boundedNumber(body.cancelCutoffMinutes, before.cancel_cutoff_minutes, 0, 10080, 1440);
    const bookingOpen = body.bookingOpen === undefined ? Number(before.booking_open) === 1 ? 1 : 0 : body.bookingOpen === true ? 1 : 0;
    const pausedMessage = textValue(body.pausedMessage, before.paused_message, 100, "현재 예약 접수가 잠시 중단되었습니다.");
    const storePhone = textValue(body.storePhone, before.store_phone, 30, "051-802-3341");
    const businessName = textValue(body.businessName, before.business_name, 80);
    const representativeName = textValue(body.representativeName, before.representative_name, 50);
    const rawBusinessNumber = textValue(body.businessRegistrationNumber, before.business_registration_number, 20);
    const businessDigits = rawBusinessNumber.replace(/\D/g, "").slice(0, 10);
    const businessRegistrationNumber = businessDigits.length === 10 ? `${businessDigits.slice(0, 3)}-${businessDigits.slice(3, 5)}-${businessDigits.slice(5)}` : "";
    const mailOrderRegistrationNumber = textValue(body.mailOrderRegistrationNumber, before.mail_order_registration_number, 80);
    const mailOrderRegistrationAuthority = textValue(body.mailOrderRegistrationAuthority, before.mail_order_registration_authority, 80);
    const mailOrderRegistrationExempt = body.mailOrderRegistrationExempt === undefined
      ? Number(before.mail_order_registration_exempt || 0) === 1
      : body.mailOrderRegistrationExempt === true;
    const businessAddress = textValue(body.businessAddress, before.business_address, 180);
    const businessEmail = textValue(body.businessEmail, before.business_email, 120).toLowerCase();
    const privacyOfficerName = textValue(body.privacyOfficerName, before.privacy_officer_name, 50);
    const operationalPiiRetentionDays = boundedNumber(body.operationalPiiRetentionDays, before.operational_pii_retention_days, 30, 365, 90);
    const legalRecordRetentionMonths = boundedNumber(body.legalRecordRetentionMonths, before.legal_record_retention_months, 60, 120, 60);
    if (businessEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(businessEmail)) {
      return json({ ok: false, error: { message: "이메일 주소를 확인해 주세요." } }, 400);
    }
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const nextVersion = `${today}-${Date.now().toString(36)}`;
    const legalIdentityChanged = [
      ["business_name", businessName], ["representative_name", representativeName],
      ["business_registration_number", businessRegistrationNumber], ["mail_order_registration_number", mailOrderRegistrationNumber],
      ["mail_order_registration_authority", mailOrderRegistrationAuthority], ["mail_order_registration_exempt", mailOrderRegistrationExempt ? 1 : 0],
      ["business_address", businessAddress], ["business_email", businessEmail], ["privacy_officer_name", privacyOfficerName], ["store_phone", storePhone],
      ["operational_pii_retention_days", operationalPiiRetentionDays], ["legal_record_retention_months", legalRecordRetentionMonths],
    ].some(([key, value]) => String(before[key] ?? "") !== String(value));
    const refundChanged = Number(before.cancel_cutoff_minutes) !== cancelCutoffMinutes;
    const consentVersion = legalIdentityChanged ? nextVersion : String(before?.consent_version || today);
    const termsVersion = legalIdentityChanged ? nextVersion : String(before?.terms_version || today);
    const refundPolicyVersion = refundChanged ? nextVersion : String(before?.refund_policy_version || today);
    await db.prepare("UPDATE booking_settings SET horizon_days = ?, lead_minutes = ?, cancel_cutoff_minutes = ?, consent_version = ?, terms_version = ?, refund_policy_version = ?, booking_open = ?, paused_message = ?, store_phone = ?, business_name = ?, representative_name = ?, business_registration_number = ?, mail_order_registration_number = ?, mail_order_registration_authority = ?, mail_order_registration_exempt = ?, business_address = ?, business_email = ?, privacy_officer_name = ?, operational_pii_retention_days = ?, legal_record_retention_months = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1")
      .bind(horizonDays, leadMinutes, cancelCutoffMinutes, consentVersion, termsVersion, refundPolicyVersion, bookingOpen, pausedMessage, storePhone, businessName, representativeName, businessRegistrationNumber, mailOrderRegistrationNumber, mailOrderRegistrationAuthority, mailOrderRegistrationExempt ? 1 : 0, businessAddress, businessEmail, privacyOfficerName, operationalPiiRetentionDays, legalRecordRetentionMonths).run();
    const after = { horizonDays, leadMinutes, cancelCutoffMinutes, consentVersion, termsVersion, refundPolicyVersion, bookingOpen, pausedMessage, storePhone, businessName, representativeName, businessRegistrationNumber, mailOrderRegistrationNumber, mailOrderRegistrationAuthority, mailOrderRegistrationExempt, businessAddress, businessEmail, privacyOfficerName, operationalPiiRetentionDays, legalRecordRetentionMonths };
    await audit(db, auth.admin.email, "update", "settings", "1", before, after);
    return json({ ok: true });
  } catch {
    return json({ ok: false, error: { message: "예약 설정을 저장하지 못했습니다." } }, 500);
  }
}
