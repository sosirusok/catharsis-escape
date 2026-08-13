# 카타르시스 이스케이프

부산 서면 카타르시스 이스케이프 공식 웹사이트 프로젝트입니다.

## 바로가기

- 웹사이트: https://sosirusok.github.io/catharsis-escape/
- 네이버 예약: https://booking.naver.com/booking/12/bizes/737799
- 네이버 지도: https://map.naver.com/p/entry/place/1626605361

## 주요 기능

- 테마별 소개와 난이도·인원 안내
- 날짜·시간·인원 선택형 예약 화면
- 대표자 이름·전화번호 입력 및 예약 내용 확인
- 인원별 이용 요금과 방문 안내
- 매장 위치·전화·네이버 예약 연결
- 데스크톱·태블릿·모바일 반응형 UI

## 개발

\`\`\`bash
npm ci
npm run dev
\`\`\`

## 검증

\`\`\`bash
npm test
npm run lint
npm run export:pages
\`\`\`

## 배포

- GitHub의 \`main\` 브랜치가 갱신되면 Actions가 테스트와 코드 검사를 실행합니다.
- 저장소의 Pages 소스를 \`GitHub Actions\`로 설정하면 공개 사이트도 자동 배포됩니다.

## 기술 구성

Next.js · React · TypeScript · Vinext · Cloudflare Workers
