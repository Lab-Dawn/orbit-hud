# NOW

## 지금 묶음: 5시간 사용량 → 주간 사용량 (승인됨, 아직 시작 안 함)

Claude가 5시간 한도를 없앴다. 세션 기록(`~/.claude/orbit-hud-live/sessions/*.json`)의 `usage`에는 이제 `ctx`와 `7d`(kind `seven_day`)만 온다. `5h`를 보던 곳이 모두 비어 있다.

### 할 일 (사용자 승인한 범위)

1. **코어 링**: 주간(`7d`) 사용량으로 채운다. 색 기준 60% 노랑 / 85% 빨강 그대로. `app/src/loop.js` (`five` → 주간).
2. **세션별 몫을 주간 누적으로**: 패널 각 줄 `5h ≈N%` → `주간 ≈N%`(언어별 문구).
   - 플러그인 `hooks/register.tsx` `trackSpend`: 기준 창을 `five_hour` → `seven_day`의 `resetsAt`으로. 주간 리셋까지 세션별 비용이 쌓인다.
   - 위젯 `app/main.js` `readSessions`: 5시간 넘은 세션 파일을 버리던 것을 7일로. 끝난 세션 파일도 남아 있으니 이번 주에 쓴 몫이 계산에 들어간다.
   - `app/src/app.js` `setWindowShares`, `S.fivePct`, `sameWindow` 등: 주간 기준으로. 이름도 five → week로 정리.
   - `app/src/panel.js` 110줄 근처 `'5h '` 표시.
3. **새로: 이번 주 많이 쓴 세션 목록**: 패널은 최근 세션만 보여서 끝난 세션의 몫이 안 보인다. 끝난 세션 포함, 이번 주 몫 큰 순서 목록을 패널 안(또는 패널 옆 카드)에 만든다. 주간 경고 알림을 누르면 이 목록이 열리게.
4. **경고 알림**: `app/src/cards.js` `watchEvents`의 5h 85% → 주간 85%, 주간 창마다 한 번.
5. **문구와 문서**: `app/i18n.js`(`usage.5h`, `notice.five*`), `hooks/i18n.ts`(`limit.five_hour`는 남겨도 됨), README 3개 언어판(72줄 `5h ≈19%`, 177줄 추정치 설명, 링 설명), README 그림(`docs/tools/capture.js` 데모 데이터의 5h → 7d, `make_docs.py` 링 그림), 주석들.

### 바꾸지 않을 것

- 호버 카드(오는 한도를 다 보여 주는 구조), 컨텍스트 게이지, 질문·채팅.
- 5시간 데이터가 다시 올 때의 대체 처리는 만들지 않는다.

### 확인 방법

- `node docs/tools/capture.js` (가짜 세션, 화면 캡처 아님)로 링, 패널 몫, 이번 주 목록, 알림을 찍어 본다.
- 실제 위젯 재시작: `node app/launch.js` (먼저 `orbit-hud-live` 경로의 electron 프로세스 종료). 링에 지금 주간 %가 나오는지 `snap-request`로 확인.
- 플러그인 검증: `claude.exe plugin validate .` (경로는 `%APPDATA%\Claude\claude-code\<버전>\<해시>\claude.exe`).

### 알아 둘 것

- 몫은 추정치다. 웹이나 다른 기기에서 쓴 양은 세션별로 나눌 수 없다.
- 적용 전 이번 주 비용은 5시간 기준으로 세던 값이라, 목록은 다음 주간 리셋부터 정확하다.
- 커밋 작성자는 jhlee <wkdrmadl3@naver.com>, Claude 기여자 줄 없음. 푸시 허용됨.
- 블로그 게시 대상(프로젝트 id: orbit-hud). 끝나면 작업기록 초안.

### 다음 한 걸음

`hooks/register.tsx`의 `trackSpend`를 `seven_day` 기준으로 바꾸는 것부터.
