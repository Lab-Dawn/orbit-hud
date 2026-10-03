# jarvis-hud

Claude Code(Windows 데스크톱 앱)용 플로팅 HUD 플러그인이에요. 화면 구석의 픽셀 아트 아크 리액터 코어 하나로 여러 세션을 지켜보고, 필요할 때만 카드가 코어 옆으로 나와요.

## 하는 일

- **코어:** 링은 5시간 사용량을 보여줘요. 세션이 작업 중이면 빛나고, Claude가 질문하면 보라색으로 바뀌어요.
- **카드:** 질문, 작업 완료, 사용량·컨텍스트 경고가 있을 때만 코어 옆으로 나왔다가 들어가요.
- **질문 응답:** Claude의 선택지 질문(AskUserQuestion)에 위젯에서 바로 답할 수 있어요.
- **패널(코어 클릭):**
  - 5시간·7일 사용량
  - 세션 목록: 지금 하는 일, 컨텍스트 게이지(누르면 압축), 이번 5시간 창에서 쓴 비중, 앱으로 이동
- **채팅(세션 클릭):** 패널 옆에 최근 대화가 나오고 메시지를 보낼 수 있어요. 작업 중에 미리 보낸 메시지는 작업이 끝날 때까지 기다리고, 그동안 취소할 수 있어요.

## 구성

| 경로 | 내용 |
| --- | --- |
| `hooks/register.tsx` | 플러그인: 세션 상태·사용량·대화를 파일로 내보내고, 위젯의 요청(압축, 답변, 메시지)을 처리 |
| `widget/widget.ps1` | WPF 위젯: 코어, 카드, 패널, 채팅 (PowerShell 5.1) |
| `types/index.d.ts` | 플러그인 상태 타입 |

플러그인과 위젯은 `~/.claude/jarvis-hud-live/` 폴더의 JSON 파일로 주고받아요.

## 설치

`~/.claude/settings.json`의 `env`에 플러그인 폴더를 등록하고 함수 훅을 켜요.

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "C:\\path\\to\\jarvis-hud",
    "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1",
    "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"
  }
}
```

`CLAUDE_CODE_PLUGIN_DIR_WATCH`는 코드를 고치면 바로 다시 불러오게 하는 개발용 설정이라 없어도 돼요.

세션이 시작되면 위젯이 자동으로 떠요. 닫았다면 `/hud widget`으로 다시 띄울 수 있어요.
