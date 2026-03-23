# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Dev server (primary app)
bun dev:web          # http://localhost:3000

# Build
bun build:web

# Lint (Biome)
bun lint:web         # check only
bun lint:web:fix     # auto-fix

# Format
bun format:web

# Tests
bun test             # all tests
bun test path/to/file.test.ts  # single file

# Docker (database + Redis, required for auth/persistence)
docker compose up -d db redis serverless-redis-http
```

## Architecture

### Monorepo structure
- `apps/web/` — Next.js 16 app (Turbopack), the entire editor
- `packages/env/` — shared env validation
- `packages/ui/` — shared UI components

All work happens in `apps/web/src/`.

### EditorCore singleton (`src/core/`)

The editor is built around a singleton class `EditorCore` (accessed via `EditorCore.getInstance()` or the `useEditor()` hook). It owns all editor state through typed managers:

| Manager | Responsibility |
|---|---|
| `PlaybackManager` | play/pause/seek, current time, volume |
| `TimelineManager` | tracks, elements, split/merge/delete/duplicate, close gaps, remove silence/retakes |
| `MediaManager` | media asset upload, file references |
| `AudioManager` | real-time audio scheduling via Web Audio API during playback |
| `CommandManager` | undo/redo stack — all mutations go through `Command` subclasses |
| `ProjectManager` | active project metadata and settings |
| `ScenesManager` | scene/bookmark management |
| `SaveManager` | auto-save loop |
| `SelectionManager` | selected elements/keyframes |

Managers subscribe to each other via `subscribe()` methods (Zustand-style). React components access the core via `useEditor()`.

### Action system (`src/lib/actions/`)

UI interactions go through a **publish-subscribe action bus**:
- `invokeAction("action-name", args?)` — fires an action from anywhere
- `useActionHandler("action-name", handler)` — registers a handler (in `src/hooks/actions/use-editor-actions.ts`)
- `definitions.ts` — all valid action names and their metadata/default keyboard shortcuts
- Adding a new action: add it to `ACTIONS` in `definitions.ts`, add a `useActionHandler` call in `use-editor-actions.ts`

### Command pattern (`src/lib/commands/`)

All timeline mutations implement `Command` with `execute()` and `undo()`. The `CommandManager` maintains the undo/redo stack. Commands are organized under `timeline/`, `media/`, `project/`, `scene/`.

### State stores (`src/stores/`)

Zustand stores for UI state that doesn't belong in EditorCore:
- `timeline-store` — snapping, ripple editing, clipboard
- `preview-store` — overlay visibility, playback UI state
- `scene-store` — scene boundaries, element→scene mapping, per-scene animation status
- `panel-store`, `properties-store`, `assets-panel-store` — panel UI state

### AI pipeline (`src/lib/scene-planner/`, `src/lib/remotion-renderer/`)

Multi-step AI pipeline for generating animated overlays:

1. **Transcript** — `generate-transcript.ts` uses Groq Whisper (or in-browser Whisper fallback) on a mixed-down mono Float32 audio buffer
2. **Detect boundaries** — `detect-boundaries.ts` calls an LLM to split the transcript into scene boundaries; stores in IndexedDB via `boundaries-store.ts`
3. **Generate direction** — `generate-scene-direction.ts` generates per-scene animation direction (beats, colors, motion specs, SFX) sequentially so each scene receives the previous scene's direction as context
4. **Generate code** — `generate-scene-code.ts` generates a Remotion React component per scene; called in parallel across all scenes after all directions are ready
5. **Render/export** — server-side via `/api/export-video` using ffmpeg; animation frames are rendered in-browser via Remotion's `OffscreenComposition`

AI provider config (API key, model, provider) is stored in localStorage via `src/lib/ai-provider.ts`. Supports OpenAI-compatible endpoints and Gemini.

Prompts live in:
- `src/lib/scene-planner/prompt.ts` — design system, animation rules, SFX library
- `src/lib/scene-planner/generate-scene-direction.ts` — `DIRECTION_SYSTEM_PROMPT`
- `src/lib/remotion-renderer/prompt.ts` — global Remotion code gen prompt
- `src/lib/remotion-renderer/generate-scene-code.ts` — `SCENE_CODE_SYSTEM_PROMPT`

### Audio (`src/lib/media/audio.ts`, `src/core/managers/audio-manager.ts`)

Two separate audio paths:
- **Playback**: `AudioManager` decodes clips to `AudioBuffer` (with caching/deduplication), schedules them on a Web Audio API graph
- **Export/transcription**: `createTimelineAudioBuffer()` mixes all timeline audio into a single `AudioBuffer` using Web Audio API `decodeAudioData` only (no mediabunny WASM — avoids SIGILL crashes on some CPUs)

### Export pipeline (`src/app/api/export-video/route.ts`, `src/services/renderer/`)

Server-side ffmpeg export. Key modes:
- Normal export: renders animation frames in-browser → uploads to server → ffmpeg composites base video + animation overlay + audio
- `faceVideoOnly`: trims and concatenates face-cam clips via ffmpeg stream copy
- `animationOnly`: encodes rendered frames directly to video

Important: filter segments with `duration < 0.01s` before passing to ffmpeg — floating-point residue from split/trim operations produces near-zero durations that ffmpeg rejects with exit code 234.

### Canvas layout (1080×1920)

All animation content must stay in the safe zone above the face cam:
- `CANVAS_TOP = 80`, `CANVAS_H = 1080` (y=80 to y=1160)
- Face cam occupies: `left=40, bottom=150, width=440, height=580` → y=1190 to y=1770
- Never render content below y=1150

### Design system (animation prompts)

- Background: `#111318`, Surface: `#1C1F2E`, Raised: `#252840`
- Text: `#F8F8F8` primary, `#9A9AA8` muted
- Accents: Red `#F55B5B`, Amber `#F5A623`, Sky `#5BB8F5`, Green `#3DD68C`, Yellow `#E8FF47`, Violet `#7B6CF6`
- Typography minimums: hero 96-120px/900, headlines 68-80px/800, subheadings 44-52px/700, body 36-42px/500, monospace 30-38px
- Available SFX: `tech_blip.wav`, `notification_ping.wav`, `error_buzz.wav`, `success_chime.wav` — `keyboard.mp3` is intentionally excluded

### Timeline data model (`src/types/timeline.ts`)

`TScene` → `TimelineTrack[]` → `TimelineElement[]`. Track types: `video`, `audio`, `text`, `sticker`, `effect`. Each element has `startTime`, `duration`, `trimStart`, `trimEnd`. The main video track has `isMain: true`. Audio tracks and video tracks both carry `muted`.

## Key conventions

- **Tabs** for indentation throughout `apps/web/src/` (enforced by Biome)
- **CRLF** line endings in some files — use Bash byte-level replacement when Edit tool fails to match
- `import type` for all type-only imports (Biome enforces this)
- `void` prefix for floating promises (`void editor.timeline.removeSilence(...)`)
- No `console.log` in production code (Biome rule) — use `console.warn` for recoverable errors
- Linter: Biome (not ESLint). Run `bun lint:web:fix` before committing.
