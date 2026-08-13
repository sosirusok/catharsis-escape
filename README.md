# 카타르시스 이스케이프

부산 서면 카타르시스 이스케이프 공식 웹사이트 프로젝트입니다.

## 바로가기

- 웹사이트: https://catharsis-escape.sosirusok.chatgpt.site
- 네이버 예약: https://booking.naver.com/booking/12/bizes/737799
- 네이버 지도: https://map.naver.com/p/entry/place/1626605361

## 주요 기능

- 테마별 소개와 난이도·인원 안내
- 날짜·시간·인원 선택형 예약 화면
- 대표자 이름·전화번호 입력 및 예약 내용 확인
- 인원별 이용 요금과 방문 안내
- 매장 위치·전화·네이버 예약 연결
- 데스크톱·태블릿·모바일 반응형 UI

온라인 예약의 최종 확정은 네이버 예약에서 진행됩니다. 자체 예약 데이터 저장은 추후 데이터베이스 연동 시 활성화할 수 있습니다.

## 개발

```bash
npm ci
npm run dev
```

## 검증

```bash
npm test
npm run lint
```

## 기술 구성

Next.js · React · TypeScript · Vinext · Cloudflare Workers
