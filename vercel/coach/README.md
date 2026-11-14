# Cork7 Replay Coach

Static replay-review page served at `/coach/`.

- Upload a locally exported video clip for playback in the browser.
- Add timestamp markers while reviewing jumps, grabs, rails, landings and crashes.
- Enter results-screen statistics and receive practice feedback.
- Save up to 100 analyses in browser local storage; export/import JSON progress.
- The video itself is not uploaded.
- **Teach AI Lab from this run** sends aggregate metrics (park, technique index, landing counts, crashes and trick variety) through the secured Vercel API. These metrics tune the separate Apex simulator and the Cork7 Solo agent's policy mutation profile.

The coach does not alter Cork7 or submit runs. Feedback is indicative practice guidance, not an exact recreation of Cork7's server-side scoring system.
