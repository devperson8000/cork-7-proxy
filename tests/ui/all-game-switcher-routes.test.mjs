import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const [cork, seas, chess, player, routes] = await Promise.all([
  readFile(new URL("vercel/c7.html", root), "utf8"),
  readFile(new URL("vercel/ss.html", root), "utf8"),
  readFile(new URL("vercel/chess.html", root), "utf8"),
  readFile(new URL("packages/demo/src/App.tsx", root), "utf8"),
  readFile(new URL("vercel/vercel.json", root), "utf8").then(JSON.parse),
]);

const pages = [
  ["Cork7 page", cork, "/c7"],
  ["SaltySeas page", seas, "/ss"],
  ["Chess.com page", chess, "/chess"],
];

for (const [pageName, html, activeRoute] of pages) {
  assert.match(html, /<nav class="nav" aria-label="Choose a game">/, pageName + " must show the game switcher");
  for (const [href, label] of [["/c7", "Cork7"], ["/ss", "SaltySeas"], ["/chess", "Chess.com"]]) {
    assert.ok(html.includes('href="' + href + '"'), pageName + " is missing " + label);
  }
  assert.ok(html.includes('href="' + activeRoute + '" aria-current="page"'), pageName + " must highlight its active game");
}

assert.ok(chess.includes('src="/chess-player"'), "Chess.com page must load the Chess.com player route");
assert.ok(chess.includes('href="/chess-player" target="_blank"'), "Chess.com Open player link must stay on the Chess.com route");

const rewriteList = routes.rewrites;
const findRewrite = (source) => rewriteList.find((r) => r.source === source);
assert.equal(findRewrite("/c7")?.destination, "/c7.html", "Cork7 root route must serve its switcher page");
assert.equal(findRewrite("/ss")?.destination, "/ss.html", "SaltySeas root route must serve its switcher page");
assert.equal(findRewrite("/chess")?.destination, "/chess.html", "Chess.com root route must serve its switcher page");
assert.ok(findRewrite("/c7/:path+"), "Cork7 asset rewrite must not swallow the root page route");
assert.ok(findRewrite("/chess/:path+"), "Chess.com deep paths must remain forwarded to the player");
assert.ok(findRewrite("/chess-player"), "Standalone Chess.com player entry route must exist");

for (const href of ["/c7", "/ss", "/chess"]) {
  assert.ok(player.includes('href="' + href + '"'), "Standalone player header is missing " + href);
}
assert.match(player, /aria-current=\{isChess \? "page" : undefined\}/, "Standalone Chess.com player must highlight Chess.com");

console.log("Game switcher all game paths: 18 assertions passed");
