import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../../vercel/index.html", import.meta.url), "utf8");

assert.match(html, /\.card-content\s*\{[^}]*container-type:\s*inline-size/s, "card content must establish a width container");
assert.match(html, /\.world-card--sea \.card-title\s*\{[^}]*font-size:\s*clamp\(34px,\s*18cqw,\s*80px\)/s, "SaltySeas title must scale to its card width");
assert.match(html, /\.world-card--chess \.card-title\s*\{[^}]*font-size:\s*clamp\(34px,\s*18cqw,\s*80px\)/s, "Chess.com title must scale to its card width");
assert.match(html, /\.world-card--sea \.card-title\s*\{[^}]*max-width:\s*100%/s, "SaltySeas title must respect card content width");
assert.match(html, /\.world-card--chess \.card-title\s*\{[^}]*max-width:\s*100%/s, "Chess.com title must respect card content width");
assert.match(html, /\.world-card--sea \.card-title\s*\{[^}]*white-space:\s*nowrap/s, "SaltySeas title must remain on one line");
assert.match(html, /\.world-card--chess \.card-title\s*\{[^}]*white-space:\s*nowrap/s, "Chess.com title must remain on one line");
assert.ok(html.includes("SALTY") && html.includes("CHESS"), "both long game headings must remain present");

console.log("Launcher card title fit: 8 assertions passed");
