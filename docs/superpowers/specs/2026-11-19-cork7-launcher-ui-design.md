# Cork7 Game Launcher UI Design

## Intent
Polish the root game-selection screen at `cork7game.vercel.app` so the two game choices feel like a cohesive, premium game launcher while preserving the familiar mountain/ocean split.

## Goals
- Retain Cork7 and SaltySeas as the two primary choices with distinct alpine and ocean visual identities.
- Improve typography, hierarchy, spacing, depth, artwork, responsive behaviour, and interaction feedback.
- Add useful launcher UI: a compact brand/status header, game labels, clear launch actions, a footer hint strip, and keyboard shortcuts (1 for Cork7, 2 for SaltySeas).
- Make the layout usable on desktop, tablet, and narrow mobile screens.
- Preserve accessible link semantics, visible keyboard focus, and reduced-motion preferences.

## Non-goals
- Do not change the game player pages, proxy configuration, API/server code, game mechanics, allowlists, or backend services.
- Do not change the existing route destinations: Cork7 remains `/c7`; SaltySeas remains `/ss`.
- Do not add external UI libraries, remote images, fonts, or runtime dependencies.

## Approaches
1. **CSS and inline-SVG refinement (chosen):** keep the existing static HTML launcher, build richer scene layers from CSS/inline SVG, and refine responsive cards and interactions. This preserves the lightweight deployment and avoids touching proxy/player code.
2. Add remote artwork or video backgrounds: visually rich but adds network dependencies, loading risk, and extra asset maintenance.
3. Rebuild as a framework app: adds complexity without improving this small static launcher enough to justify it.

## Implementation
Only `vercel/index.html` changes. Use a split, full-height pair of launch cards on wide screens and a scrollable stacked layout on narrow screens. Keep route hrefs root-relative. Keyboard shortcuts must not trigger when modifier keys are held or when focus is in an editable element. Honour `prefers-reduced-motion`.
