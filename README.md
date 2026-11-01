<div align="center">

**English** | [한국어](README.ko.md) | [日本語](README.ja.md)

<img src="docs/en/core.gif" width="560" alt="The Orbit core: idle, working, asking">

# ORBIT HUD

**All your Claude Code sessions, in one core in the corner of your screen.**

A pixel-art floating HUD that stays a single core most of the time,<br>
and slides a card out only when there's something for you to check.

![Windows](https://img.shields.io/badge/Windows-10%20%7C%2011-0078D6?logo=windows&logoColor=white)
![macOS](https://img.shields.io/badge/macOS-supported-000000?logo=apple&logoColor=white)
![Claude Code](https://img.shields.io/badge/Claude%20Code-plugin-D97757)
![Electron](https://img.shields.io/badge/Electron-38-47848F?logo=electron&logoColor=white)
![Local](https://img.shields.io/badge/network-local%20only-22D3EE)
[![License: MIT](https://img.shields.io/badge/License-MIT-4ADE80)](LICENSE)

</div>

---

## Why

Run several Claude Code sessions at once and this starts to happen:

- To see which session has finished, or which one is **asking a question and waiting**, you have to open each window.
- It's hard to tell how much of your weekly usage is left, or **which session used the most**.
- You miss the context filling up and get hit by auto-compaction.

ORBIT HUD shows all of this in **a single core**. It speaks up only when it matters, and handles small things like answering or compacting right there, without opening the app.

## Features

### ◉ Everything at a glance in one core

| Ring | Light | Color |
| --- | --- | --- |
| Fills up with your weekly usage, turning yellow at 60% and red at 85% | A lamp spins and glows while any session is working | Turns purple when someone asks a question |

<p align="center"><img src="docs/ring.png" width="560" alt="The ring at 20%, 45%, 70% and 92% of weekly usage"></p>

**The ring is your weekly usage.** It fills clockwise from 12 o'clock as you use up the current weekly window, so you can tell how much is left without opening anything: blue below 60%, yellow from 60%, red from 85%. When the week resets, the ring empties and fills up again. It shows the whole account's usage, so it reads the same whichever session you're in.

Hover over it and a card briefly shows your weekly usage and when it resets.

### ? Answer questions right from the widget

<img src="docs/en/question.png" width="420" align="right" alt="Question card">

When Claude asks a multiple-choice question, the core turns purple and a question card appears.

- If there's one question with a single answer, your answer goes out **the moment you click** an option.
- For questions with multiple answers, tick your choices and press "Answer".
- If there are several questions, page through them one at a time.
- If the answer you want isn't listed, type your own.

It shows up alongside the app's own question prompt, so you can answer from either side. To answer in the app, press **`↗`** to open that session there (the card folds away), or **`⌃`** to fold the card down to a single line until you need it. A long question scrolls inside the card instead of running off the screen.

<br clear="right">

### ▤ Session panel and chat

<img src="docs/en/panel-chat.png" alt="Session panel and chat card">

Click the core to open the session list.

- **One-line summary:** shows what each session is doing right now (`Editing payment.ts`).
- **Context gauge:** shown as blocks instead of numbers. Hover over it and it turns into a compact button; one click compacts.
- **`week ≈11%`:** that session's share of this week's usage, adding up until the weekly reset. It's calculated from a cost ledger that accounts for cheaper cached tokens.
- **This week's list:** click the weekly line at the top of the panel to see every session that used something this week, biggest first. Sessions that have already ended are included, dimmed.
- **`↗`:** jumps to that session in the app.
- **Core color = prompt cache:** the small core in front of each session shows its cache state. Normal color while the cache is valid, yellow when the time left before it expires drops below 1/5 of its lifetime (5 min / 1 h), and gray once it has expired. Hover over the core to see the time left, how much the next message will write to the cache from scratch once it has expired (`The next message writes all 720k of context to the cache again`), the hit rate (the share of input sent that was read from cache), and request and miss counts. The numbers come from the session's transcript file.

<p align="center"><img src="docs/en/week.png" width="390" alt="This week's list, opened from the weekly line"></p>

Click a session and a **chat card** opens next to the panel. You can read the recent conversation and send a message right away.

- A message sent to a session that's working **waits** and goes in once the work is done.
- You can **cancel** a waiting message in the meantime.

### ✓ Notifications only when needed

<img src="docs/en/notice.png" width="464" alt="Task complete notification">

- When work finishes, a green card lets you know. Click it to jump to that session.
- When context or weekly usage passes 85%, you get a one-time warning. Clicking the weekly warning opens this week's list.
- After a few seconds, it slips back into the core.

### ⚙ Settings

Right-click the core or press **⚙** in the panel to open the settings menu.

| Setting | What it does |
| --- | --- |
| Size | Small / medium / large core |
| Language | Auto (system language) · English · 한국어 · 日本語 |
| Notifications | When off, no card pops out on its own; only the core stays on screen |
| Reset position | Move the core back to the bottom right of the screen |
| Hide · Quit widget | Hide it for a while (bring it back with `Ctrl` + `Alt` + `O`) or close it |

<img src="docs/en/notify.png" width="666" alt="Notifications on and off">

With notifications off, neither the finished and limit cards nor the question card come out. When a question arrives only the core turns purple, so you can keep the screen clear and still catch the state at a glance. Hovering over and clicking the core work as before. `/hud notify off` · `on` does the same, and the setting is kept when the widget restarts.

## Controls

| Action | What it does |
| --- | --- |
| **Click** the core | Open / close the session panel |
| **Drag** the core | Move it anywhere (the position is remembered) |
| **Hover** over the core | Show the usage card |
| **Right-click** the core, or **⚙** in the panel | Core size, Language, Notifications on/off, Reset position, Hide, Quit widget |
| **`Ctrl` + `Alt` + `O`** (Mac: `Control` + `Option` + `O`) | Hide / show the widget from anywhere |
| `/hud on` · `/hud off` | Show / hide the widget from Claude Code |
| `/hud notify on` · `off` | Turn notifications on or off from Claude Code (off: no cards pop out, only the core stays on screen; it still turns violet for a question) |
| `/hud lang auto` · `en` · `ko` · `ja` | Change the language from Claude Code (`auto` follows the system) |
| **Click** a session row | Open the chat card (`Enter` send · `Shift+Enter` new line · `Esc` close) |

## Installation

**Requirements:** Windows 10/11 or macOS, the Claude Code desktop app with plugin function hooks support, and [Node.js](https://nodejs.org) 18 or later.

1. Clone the repository.

   ```bash
   git clone https://github.com/Lab-Dawn/orbit-hud.git
   ```

2. Register the plugin folder under `env` in `~/.claude/settings.json` and turn on function hooks.

   ```json
   {
     "env": {
       "CLAUDE_CODE_PLUGIN_DIRS": "C:\\path\\to\\orbit-hud",
       "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1"
     }
   }
   ```

   On a Mac, write the path like `/Users/<name>/path/to/orbit-hud`.

3. Restart Claude Code, and the core appears in the bottom-right corner of your screen when a session starts.

The first time, it takes about a minute to download the Electron runtime the widget uses (about 100 MB) into `~/.claude/orbit-hud-live/runtime`. Nothing is installed into the plugin folder. Because you use it straight from a `git clone`, it runs on a Mac too without a developer signature or any extra approval.

The widget and plugin UI are available in English, Korean and Japanese. By default they follow your OS language (falling back to English), and you can pick one yourself from "Language" in the panel's ⚙ menu (also the core's right-click menu) or with `/hud lang`.

> If you'll be editing the code while you use it, also add `"CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"`. Changes are reloaded the moment you save.

## How it works

```mermaid
flowchart LR
  subgraph S["Claude Code session (one per session)"]
    P["Plugin<br/>hooks/register.tsx"]
  end
  F[("~/.claude/orbit-hud-live/<br/>JSON files")]
  W["Widget<br/>app/ (Electron)"]
  P -- "status · usage · questions · conversation" --> F
  F --> W
  W -- "compact · answers · messages" --> F
  F --> P
```

- Each session's plugin writes its own state to `sessions/<session id>.json`. A single widget gathers those files and shows them.
- Compactions, answers and messages you trigger in the widget go back as files, and the plugin for that session picks them up and handles them.
- Everything exchanged is a file on your own computer. Apart from the initial Electron download, nothing goes out over the network.

## Tokens and privacy

- **It uses no tokens day to day.** Status, usage and transcripts are only read from values Claude Code already has. It never calls the model.
- **Tokens are spent only when you press something.** Compacting, chat messages and question answers use exactly as much as doing the same thing in the app.
- **Your conversations stay on your computer.** Recent conversation is exported to a local file only while a chat card is open.

## Good to know

- `week ≈N%` is an estimate. Usage outside Claude Code (the web, other devices) can't be split by session.
- Messages sent from the widget are recorded in the transcript as sent by the plugin.
- Waiting messages live only in the widget's memory, so they're lost if the widget restarts.

## Layout

| Path | Contents |
| --- | --- |
| `hooks/register.tsx` | Plugin: exports session state and handles requests from the widget (compact, answers, messages) |
| `app/` | Widget: pixel-art core, cards, panel, chat (Electron, shared by Windows and macOS) |
| `app/launch.js` | Widget launcher: installs Electron the first time, then starts the widget |
| `types/index.d.ts` | Plugin state types |
| `docs/tools/` | Scripts that reshoot the README images using fake demo sessions |

## License

[MIT](LICENSE). Anyone is free to use, modify and redistribute it. Just keep the copyright notice.

The [Galmuri](https://galmuri.quiple.dev) font used for the pixel lettering is licensed under the SIL Open Font License 1.1 (`app/fonts/Galmuri-OFL.txt`).
