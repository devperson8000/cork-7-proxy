import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../../vercel/index.html", import.meta.url), "utf8");

assert.match(html, /\.card-action\s*\{[^}]*display:\s*grid/s, "CTA must use a predictable grid layout");
assert.match(html, /\.card-action\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+22px\s+29px/s, "label must get its own flexible column");
assert.match(html, /\.card-action\s*\{[^}]*width:\s*min\(100%,\s*280px\)/s, "CTA must use the available card width");
assert.match(html, /\.card-action\s*\{[^}]*min-width:\s*0/s, "CTA must be allowed to fit the card");
assert.match(html, /\.card-action\s*\{[^}]*max-width:\s*100%/s, "CTA must remain within the card");
assert.match(html, /\.card-action\s*\{[^}]*white-space:\s*nowrap/s, "CTA container text must stay on one line");
assert.match(html, /\.action-copy\s*\{[^}]*min-width:\s*0/s, "label must use its dedicated flexible column");
assert.match(html, /\.action-copy\s*\{[^}]*white-space:\s*nowrap/s, "button label must never split into multiple lines");
assert.match(html, /\.action-copy\s*\{[^}]*overflow:\s*visible/s, "button label must not be clipped");
assert.match(html, /\.action-key\s*\{[^}]*flex:\s*0\s+0\s+22px/s, "keyboard shortcut must keep its own space");
assert.match(html, /\.action-arrow\s*\{[^}]*flex:\s*0\s+0\s+29px/s, "arrow must keep its own space");
assert.match(html, /\.world-card:focus-visible \.card-action/, "keyboard focus must visibly highlight the action");
assert.match(html, /@media \(max-width: 900px\)[\s\S]*\.action-copy \{ font-size: 9px; letter-spacing: \.08em; \}/, "tablet action labels must use compact spacing");
assert.match(html, /@media \(max-width: 390px\)[\s\S]*\.action-copy \{ font-size: 9px; letter-spacing: \.07em; \}/, "small-screen action labels must use compact spacing");

for (const label of ["PLAY CORK7", "SET SAIL", "OPEN CHESS.COM"]) {
  assert.ok(html.includes(label), "launcher label must remain present: " + label);
}

console.log("Launcher button layout: 15 assertions passed");
