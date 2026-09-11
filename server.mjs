/* 炸彈超人・自架連線伺服器
   一支程式同時做兩件事：發網頁，以及當房間的中繼站。
   誰都能連，不需要帳號。

   跑法：  npm install && node server.mjs
   然後開  http://localhost:8787
*/
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8787;

/* ---------- 靜態網頁 ---------- */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
               ".css": "text/css; charset=utf-8", ".png": "image/png", ".ico": "image/x-icon" };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  let f = url.pathname === "/" ? "/index.html" : url.pathname;
  // 只准拿這個資料夾裡的檔案，擋掉 ../ 之類的把戲
  const full = path.join(DIR, path.normalize(f).replace(/^(\.\.[/\\])+/, ""));
  if (!full.startsWith(DIR)) { res.writeHead(403).end("no"); return; }
  fs.readFile(full, (err, buf) => {
    if (err) { res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("找不到 " + f); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(full)] || "application/octet-stream",
                         "cache-control": "no-cache" });
    res.end(buf);
  });
});

/* ---------- 房間中繼 ----------
   伺服器不懂遊戲規則，只負責把每個人的狀態轉給同房間的其他人。
   運算仍然由房主那台電腦做（跟原本一樣），所以這支很輕。 */
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 256 * 1024 });
const rooms = new Map();                       // code -> Map(id -> {ws, pres})
let seq = 0;

const roomOf = (code) => {
  if (!rooms.has(code)) rooms.set(code, new Map());
  return rooms.get(code);
};
function send(ws, obj) {
  if (ws.readyState === 1) { try { ws.send(JSON.stringify(obj)); } catch {} }
}
function broadcast(room, exceptId, obj) {
  for (const [id, m] of room) if (id !== exceptId) send(m.ws, obj);
}

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://x");
  const code = (url.searchParams.get("r") || "LOBBY").toUpperCase()
    .replace(/[^A-Z0-9]/g, "").slice(0, 6) || "LOBBY";
  /* 房間鍵要帶遊戲別。兩款遊戲共用這台伺服器，房間代碼剛好撞在一起的話，
     麻將的封包會送進炸彈超人的房間裡。炸彈超人沒送 g，預設就是 bm。 */
  const game = (url.searchParams.get("g") || "bm").replace(/[^a-z]/g, "").slice(0, 4) || "bm";
  const room = roomOf(game + ":" + code);
  /* 身分要能跨重連保住。原本每次連上都發新 id，網路一抖客端在主機眼裡
     就變成另一個人：座位重配（畫面跳掉）、炸彈序號基準對不上（按不出來）。
     改成客端自帶 cid，沒被佔用就沿用。 */
  const want = (url.searchParams.get("cid") || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24);
  const id = (want && !room.has(want)) ? want : "p" + (++seq).toString(36);

  // 一間房最多 8 個人，滿了就婉拒，不要讓中繼被灌爆
  if (room.size >= 8) { send(ws, { t: "full" }); ws.close(); return; }

  /* 加入順序。改用客端自帶的 cid 之後，id 是隨機的，
     若還照字典序挑房主，就變成「誰的亂數小誰當房主」。
     用進房順序才符合「第一個進來的是房主」。 */
  room.set(id, { ws, pres: { _o: ++seq } });
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));

  // 把現有的人一次給他，之後只送異動
  const all = {};
  for (const [k, m] of room) if (k !== id) all[k] = m.pres;
  send(ws, { t: "id", peer: id, room: code, all, mine: room.get(id).pres });
  /* 新成員的初始 presence 也要讓其他人知道，否則大家看不到他的加入順序，
     選房主時只能退回比 id 字典序 —— 變成「誰的亂數小誰當房主」。 */
  broadcast(room, id, { t: "d", peer: id, d: room.get(id).pres });
  console.log(`[${new Date().toLocaleTimeString()}] ${id} 進入房間 ${code}（現有 ${room.size} 人）`);

  ws.on("message", (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    /* 指定對象傳送。麻將是暗牌遊戲，房主要一人給一份不同的畫面，
       不能像炸彈超人那樣整包廣播，否則手牌在別人的主控台裡看得一清二楚。 */
    if (m.t === "to") {
      const target = room.get(String(m.peer || ""));
      if (target) send(target.ws, { t: "m", peer: id, d: m.d });
      return;
    }
    if (m.t === "hello" || m.t === "p") {
      const me = room.get(id);
      if (!me) return;
      Object.assign(me.pres, m.d || {});
      broadcast(room, id, { t: "d", peer: id, d: m.d || {} });
    }
  });

  const leave = () => {
    if (!room.has(id)) return;
    room.delete(id);
    broadcast(room, id, { t: "bye", peer: id });
    console.log(`[${new Date().toLocaleTimeString()}] ${id} 離開房間 ${code}（剩 ${room.size} 人）`);
    if (!room.size) rooms.delete(code);
  };
  ws.on("close", leave);
  ws.on("error", leave);
});

// 每 30 秒踢掉沒回應的連線，免得房間名單留著幽靈
setInterval(() => {
  for (const client of wss.clients) {
    if (client.isAlive === false) { client.terminate(); continue; }
    client.isAlive = false;
    try { client.ping(); } catch {}
  }
}, 30000);

server.listen(PORT, () => {
  console.log(`連線遊戲伺服器啟動`);
  console.log(`  炸彈超人  http://localhost:${PORT}/`);
  console.log(`  十六張    http://localhost:${PORT}/mahjong.html`);
  console.log(`把公開網址傳給朋友就能一起玩，不需要登入。`);
});
