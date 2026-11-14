# Cork7 Replay Coach

Static replay-review page served at /coach/.

- Upload a locally exported video clip for playback in the browser.
- Add timestamp markers while reviewing jumps, grabs, rails, landings and crashes.
- Enter results-screen statistics and receive heuristic coaching feedback.
- Save up to 100 analyses in browser local storage; export/import JSON progress.
- The video itself is not uploaded.
- Clicking **Teach AI Lab from this run** sends only aggregate run metrics (park, technique index, landing counts, crash count and trick variety) through the secured Vercel API to Northflank. These values tune the separate simulator's training priorities.

The coach does not automate gameplay, alter Cork7, submit scores or interact with Cork7's leaderboard. The separate /bot/ page remains the autonomous Apex-style simulator lab.

Feedback is indicative practice guidance, not an exact recreation of Cork7's server-side scoring system.