import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const html = await readFile(resolve(process.cwd(), "vercel/index.html"), "utf8");
const anchors = [...html.matchAll(/<a\b[^>]*>/g)].map(([tag]) => tag);

assert.ok(anchors.some((tag) => /href=["']\/c7["']/.test(tag)), "Cork7 must link to /c7");
assert.ok(anchors.some((tag) => /href=["']\/ss["']/.test(tag)), "SaltySeas must link to /ss");
assert.match(html, /class=["'][^"']*world-grid/, "launcher must use the responsive world grid");
assert.match(html, /data-launch-key=["']1["']/, "Cork7 shortcut hint must be present");
assert.match(html, /data-launch-key=["']2["']/, "SaltySeas shortcut hint must be present");
assert.match(html, /prefers-reduced-motion/, "motion preferences must be respected");
assert.match(html, /addEventListener\(["']keydown["']/, "keyboard launch shortcuts must be wired");

assert.match(html, /\\.artwork\\s*\\{[^}]*z-index:\\s*0/s, "artwork must sit above the card background");
assert.match(html, /\\.world-card::before\\s*\\{[^}]*z-index:\\s*1/s, "contrast overlay must sit above artwork");
assert.match(html, /\\.card-head,\\s*\\.card-content,\\s*\\.card-foot\\s*\\{[^}]*z-index:\\s*3/s, "card content must sit above both overlays");

console.log("Launcher contract: 10 assertions passed");
