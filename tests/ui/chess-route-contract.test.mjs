import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [launcher, vercel, server, app, env, docs] = await Promise.all([
  read("../../vercel/index.html"),
  read("../../vercel/vercel.json"),
  read("../../server/wisp-server.mjs"),
  read("../../packages/demo/src/App.tsx"),
  read("../../.env.northflank.example"),
  read("../../NORTHFLANK.md")
]);

assert.match(launcher, /href="\/chess"[^>]*data-launch-key="3"/, "launcher must include Chess.com at /chess");
assert.match(launcher, /3 WORLDS/, "launcher header must count all three destinations");
assert.match(launcher, /\["3", document\.querySelector\('\[data-launch-key="3"\]'\)\]/, "3 must launch Chess.com");
assert.match(vercel, /"source": "\/chess"[\s\S]*?"destination": "https:\/\/[^"]+\/chess-player\/"/, "/chess must rewrite to the Northflank Chess player");
assert.match(vercel, /"source": "\/chess\/:path\*"[\s\S]*?"destination": "https:\/\/[^"]+\/chess-player\/:path\*"/, "Chess path assets must retain their suffix");
assert.match(server, /const CHESS_PLAYER_PATH = "\/chess-player"/, "Northflank must expose a dedicated Chess player alias");
assert.match(server, /const CHESS_TARGET_URL = "https:\/\/www\.chess\.com\/"/, "Chess alias must open Chess.com");
assert.match(server, /isChessPlayerPath/, "Northflank must recognise the Chess player path");
assert.match(server, /CHESS_PLAYER_PATH \+ pathname\.slice\(CHESS_PLAYER_PATH\.length\)/, "Chess alias must reuse the shared player assets");
assert.match(server, /hostname\.toLowerCase\(\) === CHESS_WWW_HOST \? "chess"/, "runtime config must identify Chess.com mode");
assert.match(app, /runtimeConfig\?\.site === "chess"/, "player header must support Chess mode");
assert.match(app, /theme-chess/, "player must have a Chess theme");
assert.match(env, /CORK7_ALLOWED_HOSTS=.*www\.chess\.com/, "Northflank example must include exact Chess.com hosts");
assert.match(docs, /\/chess-player\//, "Northflank instructions must document the Chess player alias");

console.log("Chess route contract: 14 assertions passed");
