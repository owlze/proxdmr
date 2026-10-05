# ProxDMR Frontend Architecture (ES6 Modules)

This document describes the architectural plan for refactoring the monolithic `app.js` file (23,000+ lines) into modular ES6 modules.

## Current Problem
All frontend code was historically wrapped in a single `document.addEventListener("DOMContentLoaded", ...)` handler inside `app.js`.
This led to:
1. Difficult code navigation.
2. High regression risks during changes.
3. High LLM context overhead.

## Target Structure (Module Tree)

All modules reside in the `src/static/js/modules/` directory.

### 1. `core/` (Core & Utilities)
- **`auth.js`** — Token validation, authentication state.
- **`api.js`** — `fetch` wrappers, error handling.
- **`utils.js`** — Pure helper functions (date formatting, flag helpers, delays, debounce).
- **`state.js`** — Global application state (navigation, view history, `accountSettings`).
- **`toast.js`** — HUD notification system (toasts).

### 2. `audio/` (Audio & Media)
- **`volume.js`** — Volume control (Master, per-hotspot).
- **`stereo.js`** — Audio panning (L/R/L+R) for timeslots.
- **`player.js`** — Audio recording playback player (`RecordingsManager`).
- **`webrtc.js`** — Live audio stream handling, PTT engine.

### 3. `ui/` (User Interface)
- **`navigation.js`** — Panel layout management, fullscreen mode.
- **`long-press.js`** — Long-press gesture handling on cards.
- **`modals/quick-assign.js`** — Quick TG/ID assignment modal logic.
- **`modals/contacts.js`** — Address book management.
- **`modals/bm-info.js`** — Detailed BrandMeister status and info.

### 4. `dmr/` (Business Logic)
- **`bm-monitor.js`** — Live BrandMeister activity monitor.
- **`routing.js`** — Direct Call and timeslot routing logic.

### 5. `app.js` (Entry Point)
Functions as a lean controller orchestrating modules:
```javascript
import { initUtils } from './modules/core/utils.js';
import { initAudio } from './modules/audio/volume.js';
import { initRecordings } from './modules/audio/player.js';

document.addEventListener("DOMContentLoaded", () => {
    initUtils();
    initAudio();
    initRecordings();
    // ...
});
```

## Step-by-Step Migration Strategy
1. Load `app.js` as `<script type="module" src="...app.js">`.
2. Extract **one isolated fragment** (e.g. `utils.js`).
3. Export its functions and import them in `app.js`.
4. Test in the browser.
5. Repeat iteratively for remaining components.
