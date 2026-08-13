import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "카타르시스 이스케이프 | 부산 서면 방탈출",
  description:
    "부산 서면 카타르시스 이스케이프. 테마, 이용 요금, 예약, 오시는 길을 확인하세요.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "카타르시스 이스케이프",
    description: "일상에서 탈출하는 단 60분.",
    type: "website",
    locale: "ko_KR",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
