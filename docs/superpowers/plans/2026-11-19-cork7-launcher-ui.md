# Cork7 Launcher UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Cork7/SaltySeas launcher UI without changing either game's routes or proxy implementation.

**Architecture:** Keep the launcher as one static HTML document with inline CSS and a small progressive-enhancement script for keyboard shortcuts. Build the visual scene from CSS and inline SVG rather than remote assets or a new framework.

**Tech Stack:** HTML, CSS, vanilla JavaScript, GitHub-connected Vercel static deployment.

**Spec:** `docs/superpowers/specs/2026-11-19-cork7-launcher-ui-design.md`

## Global Constraints
- Cork7 must continue linking to `/c7`.
- SaltySeas must continue linking to `/ss`.
- Do not modify `vercel/c7.html`, `vercel/ss.html`, or `vercel/vercel.json`.
- Do not add external libraries, fonts, images, or runtime dependencies.
- Preserve reduced-motion support and visible keyboard focus.

## Review Focus
- Narrow mobile widths: ensure the layout stacks without horizontal overflow and both cards remain usable.
- Short viewport heights: ensure card content and launch actions remain reachable through scrolling.
- Keyboard input with modifiers or editable focus: shortcuts must not hijack browser or text-entry commands.
- Reduced-motion preference: disable non-essential transitions and ambient animations.
- Route integrity: both anchor destinations remain exactly `/c7` and `/ss`.

---

### Task 1: Polish the static game launcher

**Files:**
- Modify: `vercel/index.html`

**Interfaces:**
- Consumes: the existing two routes, `/c7` and `/ss`.
- Produces: a responsive launcher page with semantic anchors, accessible interaction states, and 1/2 keyboard shortcuts.

- [ ] **Step 1: Record the baseline invariants** — confirm the current launcher contains exactly one Cork7 link to `/c7` and one SaltySeas link to `/ss`.
- [ ] **Step 2: Refine the markup and scene styling** — update only `vercel/index.html`; use paired full-height desktop cards, stacked mobile cards, stronger brand hierarchy, CSS/inline-SVG environmental artwork, refined CTAs, a footer hint/status strip, and responsive sizing.
- [ ] **Step 3: Add keyboard launch enhancement** — support `1` for `/c7` and `2` for `/ss`, ignoring modified keystrokes and editable targets.
- [ ] **Step 4: Verify static invariants** — confirm semantic route links remain unchanged, focus styles and reduced-motion rules exist, and no game/player or proxy files changed.
- [ ] **Step 5: Deploy and verify** — verify the Vercel production deployment and fetch `/`, `/c7`, and `/ss`; ensure the homepage contains the new launcher and route pages remain served.

