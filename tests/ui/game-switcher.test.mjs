import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const [cork, seas, player] = await Promise.all([
  readFile(new URL("vercel/c7.html", root), "utf8"),
  readFile(new URL("vercel/ss.html", root), "utf8"),
  readFile(new URL("packages/demo/src/App.tsx", root), "utf8"),
]);

const routes = [
  ['href="/c7"', "Cork7"],
  ['href="/ss"', "SaltySeas"],
  ['href="/chess"', "Chess.com"],
];

for (const [href, label] of routes) {
  assert.ok(cork.includes(href), "Cork7 page is missing " + label + " switcher link");
  assert.ok(seas.includes(href), "SaltySeas page is missing " + label + " switcher link");
  assert.ok(player.includes(href), "Chess player is missing " + label + " switcher link");
}

assert.match(cork, /href="\/c7" aria-current="page"/, "Cork7 must be active on the Cork7 page");
assert.match(seas, /href="\/ss" aria-current="page"/, "SaltySeas must be active on the SaltySeas page");
assert.match(player, /href="\/c7" aria-current=\{siteMode === "alpine" \? "page" : undefined\}/);
assert.match(player, /href="\/ss" aria-current=\{isPirate \? "page" : undefined\}/);
assert.match(player, /href="\/chess" aria-current=\{isChess \? "page" : undefined\}/);
assert.match(player, /\.game-switcher a\[aria-current="page"\]/, "The current game needs a visible active state");
assert.match(player, /@media \(max-width: 600px\)[\s\S]*\.game-switcher a \{ flex: 1 1 0;/, "Chess player switcher must fit mobile widths");

console.log("Three-game switcher: 16 assertions passed");
