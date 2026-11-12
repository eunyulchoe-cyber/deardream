/* 빌드별 설정. 배포된 Worker 주소(키 없음, 공개 주소). 서버에 닿지 않으면 기기 안 '간단 읽기'로 동작.
 * localhost에서 열면 config.js가 로컬 wrangler dev(8787)를 우선 사용 (?api= 로 덮어쓰기 가능).
 * 안드로이드: app/ 의 copy-web 이 이 파일을 DD_API_BASE(기본 = 아래 주소)로 다시 씀. */
window.DD_ENV = { API_BASE: "https://deardream-api.deardream.workers.dev" };
