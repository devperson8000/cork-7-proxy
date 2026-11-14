# Apex Lab — Cork7-style AI Trainer

A static, free-to-host machine-learning playground served at `/bot/` by the existing Vercel project.

## What it does

- Runs a neural-network rider policy in an original Apex-style freestyle course simulation.
- Uses neuroevolution: tournament selection, elite preservation, crossover, adaptive Gaussian mutation, and a novelty bonus for discovering varied clean trick combinations.
- Displays the active rider, simulator points, learning curve, and discovered trick families.
- Saves policy weights, training history, trick discoveries, and the best replay in the current browser's local storage.
- Replays the best saved run and records a WebM clip from the canvas when browser recording is supported.

## Free hosting model

Vercel serves the static page. The training computation runs in the visitor's browser while the page is open; it is not a server-side process. Saved progress is browser-local and is not shared between devices.

## Scope

This is an original training simulation with simplified skiing physics and an Apex-inspired line. It does not inspect, control, or submit runs to the official Cork7 service.
