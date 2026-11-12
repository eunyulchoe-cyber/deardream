/* 빌드별 설정. 기본(폰/배포 빌드)은 비어 있음 → 서버 없으면 기기 안 '간단 읽기'로 동작.
 * 에뮬레이터용 디버그 빌드만 app/ 의 `npm run build:debug:emu` 가 이 파일을 API_BASE=http://10.0.2.2:8787 로 덮어씀.
 * Worker를 배포하면 여기(또는 config.js)에 https://deardream-api.<계정>.workers.dev 를 넣는다. */
window.DD_ENV = { API_BASE: "" };
