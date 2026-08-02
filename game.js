/* =========================================================================
   TIC-PAC-MAN
   A 2-player mashup of Pac-Man and Tic-Tac-Toe, played on the classic
   Pac-Man maze. The maze is divided into a 3x3 grid of scoring REGIONS
   (faint lines, not walls). Claim the 9 regions (P1 = yellow X, P2 = red O);
   three in a row wins.

   Claim a region by either (chosen in setup):
     - First to Finish: eat every dot in the region.
     - Percent (75%): dots get painted your colour as you pass; own >=75% to
       claim, recolour to steal. Always reclaimable.

   Optional Ghosts: 4 ghosts leave the center cage and chase nearby players.
   Eat a Big Pellet (one per region) to turn them blue & edible for a while.
   A normal ghost that catches you sends you back to your spawn.

   Movement is GRID-LOCKED (classic Pac-Man): ride corridor center lines,
   turn at tile centers, never overlap a wall.
   ========================================================================= */

const TILE = 24;

/* ------------------------------- The maze -------------------------------- */
// '#'=wall  '.'=dot  'o'=big dot(original power pellets, kept as dots)
// '='=ghost-house door (wall to players)  ' '=walkable, no dot (cage/sides)
const MAZE = [
  "############################",
  "#............##............#",
  "#.####.#####.##.#####.####.#",
  "#o####.#####.##.#####.####o#",
  "#.####.#####.##.#####.####.#",
  "#..........................#",
  "#.####.##.########.##.####.#",
  "#.####.##.########.##.####.#",
  "#......##....##....##......#",
  "######.#####.##.#####.######",
  "######.#####.##.#####.######",
  "######.##..........##.######",
  "######.##.###==###.##.######",
  "######.##.#      #.##.######",
  "..........#      #..........",
  "######.##.#      #.##.######",
  "######.##.########.##.######",
  "######.##..........##.######",
  "######.#####.##.#####.######",
  "######.#####.##.#####.######",
  "#............##............#",
  "#.####.#####.##.#####.####.#",
  "#.####.#####.##.#####.####.#",
  "#o..##................##..o#",
  "###.##.##.########.##.##.###",
  "###.##.##.########.##.##.###",
  "#......##....##....##......#",
  "#.##########.##.##########.#",
  "#.##########.##.##########.#",
  "#..........................#",
  "############################",
];
const ROWS = MAZE.length;
const COLS = MAZE[0].length;

// 3x3 scoring-region boundaries (tile edges).
const COL_EDGES = [0, 9, 19, 28];
const ROW_EDGES = [0, 10, 21, 31];
const regionCol = (c) => (c < COL_EDGES[1] ? 0 : c < COL_EDGES[2] ? 1 : 2);
const regionRow = (r) => (r < ROW_EDGES[1] ? 0 : r < ROW_EDGES[2] ? 1 : 2);

const ch = (r, c) => (r < 0 || c < 0 || r >= ROWS || c >= COLS ? "#" : MAZE[r][c]);
const isWall = (r, c) => { const x = ch(r, c); return x === "#" || x === "="; };
const isDotCell = (r, c) => { const x = ch(r, c); return x === "." || x === "o"; };

// Ghost-house geometry.
const CAGE_EXIT = { r: 11, c: 13 };   // tile just above the door
const CAGE_HOME = { r: 14, c: 13 };   // inside the cage

// Row with the wrap-around side tunnels (open at both ends).
const TUNNEL_ROW = 14;

/* ------------------------------- Game state ------------------------------ */
const COLORS = { 1: "#ffe600", 2: "#ff3b30", 3: "#2bff88" };
const DOT_NEUTRAL = "#ffb8ae";
const MAZE_COLOR = "#2121de";
const FRIGHT_COLOR = "#2233ff";
const GHOST_COLORS = ["#ff9ff3", "#54e0ff", "#ffb852", "#a98bff"];

// A hex colour (#rrggbb) as an rgba() string with the given alpha.
function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// players: 2 (P1 vs P2) or 3 (adds P3, green triangle, IJKL keys).
// strength: eat-more-dots -> faster & bigger (optional).
// stall: caught by a ghost freezes you for 2s instead of respawning.
// collide: players block each other instead of passing through.
const config = { mode: "finish", reclaim: false, ghosts: false, players: 3, strength: true, stall: false, collide: false };

// Centre-to-centre gap players stop at when collision is on (< 1 tile so
// it never falsely blocks parallel corridors separated by a wall).
const PLAYER_COLL_DIST = TILE * 0.92;

const dots = [];        // dots[r][c] = dot still present
const dotOwner = [];    // 0/1/2 (percent mode colour)
const isBig = [];       // big-pellet tile (only when ghosts on)
const bigConsumed = []; // big pellet permanently eaten (never respawns)
const lifetime = { 1: 0, 2: 0, 3: 0 }; // total dots eaten per player -> "strength"
const mkGrid = () => [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
const dotsRemaining = mkGrid();
const dotsTotalPerCell = mkGrid();
// Percent-mode painted-dot counts per player: paint[id][regionRow][regionCol].
const paint = { 1: mkGrid(), 2: mkGrid(), 3: mkGrid() };

const ALL_IDS = [1, 2, 3];

let board;          // board[row][col] = owner (0/1/2/3)
let players;
let activeIds = [1, 2]; // player ids in play this round (set from config.players)
let ghosts = [];
let frightTimer = 0; // seconds remaining of frightened mode
let clock = 0;       // seconds since round start (for ghost release)
let started = false;
let gameOver = false;
let winner = null;
let winLine = null;

const KEYMAPS = {
  1: { up: "w", down: "s", left: "a", right: "d" },
  2: { up: "arrowup", down: "arrowdown", left: "arrowleft", right: "arrowright" },
  3: { up: "i", down: "k", left: "j", right: "l" },
};

// Random start positions: pick n distinct dot tiles (always walkable corridor,
// never a wall or the ghost cage), spread apart so no one starts on top of a
// rival. Falls back to any distinct tiles if the spacing can't be satisfied.
function randomSpawns(n) {
  const cands = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (isDotCell(r, c)) cands.push({ r, c });
  const pick = () => cands[(Math.random() * cands.length) | 0];
  const chosen = [];
  const MIN_D = 6; // min tile separation between spawns
  for (let tries = 0; chosen.length < n && tries < 4000; tries++) {
    const t = pick();
    if (chosen.some((o) => Math.hypot(o.r - t.r, o.c - t.c) < MIN_D)) continue;
    chosen.push(t);
  }
  while (chosen.length < n) {
    const t = pick();
    if (!chosen.some((o) => o.r === t.r && o.c === t.c)) chosen.push(t);
  }
  return chosen.map((t) => ({ r: t.r, c: t.c, face: t.c < COLS / 2 ? 1 : -1 }));
}

const canvas = document.getElementById("game");
canvas.width = COLS * TILE;
canvas.height = ROWS * TILE;
const ctx = canvas.getContext("2d");

function tileCenter(r, c) { return { x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 }; }
function nearestTile(o) { return { c: Math.round((o.x - TILE / 2) / TILE), r: Math.round((o.y - TILE / 2) / TILE) }; }
function regionCenterPx(rr, cc) {
  return {
    x: ((COL_EDGES[cc] + COL_EDGES[cc + 1]) / 2) * TILE,
    y: ((ROW_EDGES[rr] + ROW_EDGES[rr + 1]) / 2) * TILE,
  };
}

/* --------------------------- Big-pellet layout --------------------------- */
// Choose one big pellet per region: the dot tile nearest the region center.
function chooseBigPellets() {
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) isBig[r][c] = false;
  for (let rr = 0; rr < 3; rr++) {
    for (let cc = 0; cc < 3; cc++) {
      const cen = regionCenterPx(rr, cc);
      let best = null, bd = Infinity;
      for (let r = ROW_EDGES[rr]; r < ROW_EDGES[rr + 1]; r++) {
        for (let c = COL_EDGES[cc]; c < COL_EDGES[cc + 1]; c++) {
          if (!isDotCell(r, c)) continue;
          const p = tileCenter(r, c);
          const d = (p.x - cen.x) ** 2 + (p.y - cen.y) ** 2;
          if (d < bd) { bd = d; best = { r, c }; }
        }
      }
      if (best) isBig[best.r][best.c] = true;
    }
  }
}

/* ------------------------------ Reset / start ---------------------------- */
function refillDots() {
  for (let rr = 0; rr < 3; rr++) for (let cc = 0; cc < 3; cc++) {
    dotsRemaining[rr][cc] = 0;
    for (const id of ALL_IDS) paint[id][rr][cc] = 0;
  }
  for (let r = 0; r < ROWS; r++) {
    dots[r] = []; dotOwner[r] = []; bigConsumed[r] = [];
    if (!isBig[r]) isBig[r] = [];
    for (let c = 0; c < COLS; c++) {
      const has = isDotCell(r, c);
      dots[r][c] = has;
      dotOwner[r][c] = 0;
      bigConsumed[r][c] = false;
      if (has) dotsRemaining[regionRow(r)][regionCol(c)]++;
    }
  }
  for (let rr = 0; rr < 3; rr++) for (let cc = 0; cc < 3; cc++) dotsTotalPerCell[rr][cc] = dotsRemaining[rr][cc];
  if (config.ghosts) chooseBigPellets();
  else for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) isBig[r][c] = false;
}

function respawnCell(row, col) {
  // Restore normal dots, but big pellets that were eaten stay gone forever.
  let cnt = 0;
  for (let r = ROW_EDGES[row]; r < ROW_EDGES[row + 1]; r++)
    for (let c = COL_EDGES[col]; c < COL_EDGES[col + 1]; c++)
      if (isDotCell(r, c) && !bigConsumed[r][c]) { dots[r][c] = true; cnt++; }
  dotsRemaining[row][col] = cnt;
}

function makePlayer(id, keymap, spawn) {
  const s = tileCenter(spawn.r, spawn.c);
  return { id, x: s.x, y: s.y, r: TILE * 0.42, speed: 2.0, dir: { x: 0, y: 0 },
    faceX: spawn.face, faceY: 0, keymap, color: COLORS[id],
    spawnR: spawn.r, spawnC: spawn.c, // where a ghost sends you back to
    stall: 0, invuln: 0 };            // ghost-stall freeze + brief post-freeze immunity
}

function makeGhosts() {
  // speed: index0 slow, 1&2 normal, 3 fast
  const speeds = [1.5, 1.7, 1.7, 1.9];
  const scatter = [{ r: 1, c: 1 }, { r: 1, c: COLS - 2 }, { r: ROWS - 2, c: 1 }, { r: ROWS - 2, c: COLS - 2 }];
  const cols = [12, 13, 14, 15];
  return cols.map((col, i) => {
    const p = tileCenter(14, col);
    return {
      i, x: p.x, y: p.y, r: TILE * 0.46,
      speed: speeds[i], color: GHOST_COLORS[i],
      dir: { x: 0, y: -1 }, mode: "caged",
      releaseAt: i * 2.2, scatter: scatter[i],
      homeX: p.x, homeY: p.y,
    };
  });
}

function resetGame() {
  refillDots();
  board = mkGrid();
  activeIds = config.players === 3 ? [1, 2, 3] : [1, 2];
  const spawns = randomSpawns(activeIds.length);
  players = activeIds.map((id, i) => makePlayer(id, KEYMAPS[id], spawns[i]));
  ghosts = config.ghosts ? makeGhosts() : [];
  frightTimer = 0;
  clock = 0;
  for (const id of ALL_IDS) lifetime[id] = 0;
  gameOver = false; winner = null; winLine = null;
  held.clear(); pressOrder.length = 0;
  syncPlayerCards();
  updateHud();
}

function startGame() { initAudio(); resumeAudio(); resetGame(); started = true; startScreen.classList.add("hidden"); }
function openSettings() { started = false; syncSettingsUI(); startScreen.classList.remove("hidden"); }

/* --------------------------------- Input --------------------------------- */
const held = new Set();
const pressOrder = [];

window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
  if (k === "m") { audio.on = !audio.on; return; } // mute toggle
  if (!startScreen.classList.contains("hidden")) return;
  if (gameOver) {
    if (k === "enter" || k === " ") { resetGame(); return; }
    if (k === "s") { openSettings(); return; }
  }
  if (!started) return;
  if (!held.has(k)) { held.add(k); pressOrder.push(k); }
});
window.addEventListener("keyup", (e) => {
  const k = e.key.toLowerCase();
  held.delete(k);
  const i = pressOrder.indexOf(k);
  if (i !== -1) pressOrder.splice(i, 1);
});
window.addEventListener("blur", () => { held.clear(); pressOrder.length = 0; });

function wantDir(p) {
  for (let i = pressOrder.length - 1; i >= 0; i--) {
    const k = pressOrder[i];
    if (k === p.keymap.up) return { x: 0, y: -1 };
    if (k === p.keymap.down) return { x: 0, y: 1 };
    if (k === p.keymap.left) return { x: -1, y: 0 };
    if (k === p.keymap.right) return { x: 1, y: 0 };
  }
  return { x: 0, y: 0 };
}

/* ------------------------------- Movement -------------------------------- */
const canMovePlayer = (r, c, d) => {
  const nc = c + d.x;
  if (r === TUNNEL_ROW && d.y === 0 && (nc < 0 || nc >= COLS)) return true; // tunnel mouth
  return !isWall(r + d.y, nc);
};
function approach(v, t, step) { return Math.abs(t - v) <= step ? t : v + Math.sign(t - v) * step; }

// Wrap an entity around the side tunnels when it leaves the maze on TUNNEL_ROW.
function wrapTunnel(o) {
  const row = Math.round((o.y - TILE / 2) / TILE);
  if (row !== TUNNEL_ROW) return;
  const W = COLS * TILE;
  if (o.x < 0) o.x += W;
  else if (o.x >= W) o.x -= W;
}

// The more dots you've eaten relative to your opponent, the faster & bigger
// you are -- so aggressively eating beats passively trailing to steal squares.
function applyStrength(p) {
  if (!config.strength) { p.speed = 2.0; p.r = TILE * 0.42; return; } // equal, constant speed
  let sum = 0, n = 0;
  for (const q of players) if (q.id !== p.id) { sum += lifetime[q.id]; n++; }
  const diff = lifetime[p.id] - (n ? sum / n : 0); // vs. average rival
  const boost = Math.max(-0.2, Math.min(0.32, diff / 350));
  p.speed = 2.0 * (1 + boost);
  p.r = TILE * 0.42 * (1 + boost * 0.35);
}

// True if p's new position moves it into (or presses it against) another
// player. Motion that increases the gap is always allowed, so bumped players
// can still back away and go around.
function hitsAnotherPlayer(p, oldx, oldy) {
  for (const q of players) {
    if (q === p) continue;
    const dNew = Math.hypot(p.x - q.x, p.y - q.y);
    if (dNew < PLAYER_COLL_DIST) {
      const dOld = Math.hypot(oldx - q.x, oldy - q.y);
      if (dNew <= dOld) return true;
    }
  }
  return false;
}

function updatePlayer(p, dt) {
  if (p.invuln > 0) p.invuln = Math.max(0, p.invuln - dt / 60);
  if (p.stall > 0) {                       // frozen after a ghost catch
    p.stall = Math.max(0, p.stall - dt / 60);
    if (p.stall === 0) p.invuln = 0.8;     // brief grace so you aren't re-caught instantly
    p.dir = { x: 0, y: 0 };
    return;
  }
  applyStrength(p);
  const sx = p.x, sy = p.y;                 // frame-start position (for collision revert)
  const step = p.speed * dt;
  const { r: cr, c: cc } = nearestTile(p);
  const { x: cenx, y: ceny } = tileCenter(cr, cc);
  const want = wantDir(p);

  if (want.x === 0 && want.y === 0) {
    p.x = approach(p.x, cenx, step);
    p.y = approach(p.y, ceny, step);
    p.dir = { x: 0, y: 0 };
    onTile(p, cr, cc);
    return;
  }
  if (want.x !== 0) {
    if (Math.abs(p.y - ceny) <= step && canMovePlayer(cr, cc, want)) { p.y = ceny; p.dir = { x: want.x, y: 0 }; }
  } else if (want.y !== 0) {
    if (Math.abs(p.x - cenx) <= step && canMovePlayer(cr, cc, want)) { p.x = cenx; p.dir = { x: 0, y: want.y }; }
  }
  if (p.dir.x !== 0 || p.dir.y !== 0) {
    if (!canMovePlayer(cr, cc, p.dir)) {
      p.x = approach(p.x, cenx, step); p.y = approach(p.y, ceny, step);
    } else {
      p.x += p.dir.x * step; p.y += p.dir.y * step;
      if (p.dir.x !== 0) p.y = ceny;
      if (p.dir.y !== 0) p.x = cenx;
      if (config.collide && hitsAnotherPlayer(p, sx, sy)) { p.x = sx; p.y = sy; }
    }
    p.faceX = p.dir.x; p.faceY = p.dir.y;
  }
  onTile(p, cr, cc);
  wrapTunnel(p);
}

/* --------------------------- Dots / claiming ----------------------------- */
function onTile(p, cr, cc) {
  if (cr < 0 || cc < 0 || cr >= ROWS || cc >= COLS) return;
  if (!dots[cr][cc]) return;
  const cen = tileCenter(cr, cc);
  if (Math.hypot(cen.x - p.x, cen.y - p.y) > TILE * 0.5) return;

  if (isBig[cr][cc] && config.ghosts) { consumeBig(p, cr, cc); return; }
  if (config.mode === "percent") paintDot(p, cr, cc);
  else eatDot(p, cr, cc);
}

function eatDot(p, cr, cc) {
  dots[cr][cc] = false;
  lifetime[p.id]++;
  const rr = regionRow(cr), cc2 = regionCol(cc);
  if (--dotsRemaining[rr][cc2] !== 0) return;
  if (config.reclaim || board[rr][cc2] === 0) {
    setOwner(rr, cc2, p.id);
    if (!gameOver && config.reclaim) respawnCell(rr, cc2);
  }
}

function paintDot(p, cr, cc) {
  const old = dotOwner[cr][cc];
  if (old === p.id) return;
  const rr = regionRow(cr), cc2 = regionCol(cc);
  if (old) paint[old][rr][cc2]--;
  dotOwner[cr][cc] = p.id;
  paint[p.id][rr][cc2]++;
  lifetime[p.id]++;
  reevaluatePercent(rr, cc2);
}

function reevaluatePercent(rr, cc) {
  const T = dotsTotalPerCell[rr][cc] || 1;
  const need = Math.ceil(T * 0.75);
  let owner = 0;
  for (const id of activeIds) if (paint[id][rr][cc] >= need) { owner = id; break; }
  setOwner(rr, cc, owner);
}

// A Big Pellet is a one-time power-up: it is permanently removed when eaten
// (even in reclaim mode) and triggers frightened ghosts.
function consumeBig(p, cr, cc) {
  dots[cr][cc] = false;
  bigConsumed[cr][cc] = true;
  lifetime[p.id]++;
  frighten();
  const rr = regionRow(cr), cc2 = regionCol(cc);
  dotsTotalPerCell[rr][cc2] = Math.max(0, dotsTotalPerCell[rr][cc2] - 1);
  if (config.mode === "percent") {
    const old = dotOwner[cr][cc];
    if (old) paint[old][rr][cc2]--;
    dotOwner[cr][cc] = 0;
    reevaluatePercent(rr, cc2);
  } else if (--dotsRemaining[rr][cc2] <= 0) {
    dotsRemaining[rr][cc2] = 0;
    if (config.reclaim || board[rr][cc2] === 0) {
      setOwner(rr, cc2, p.id);
      if (!gameOver && config.reclaim) respawnCell(rr, cc2);
    }
  }
}

function setOwner(row, col, owner) {
  if (board[row][col] === owner) return;
  board[row][col] = owner;
  updateHud();
  if (owner !== 0) {
    const res = checkWin();
    if (res) { winner = res.winner; winLine = res.line; gameOver = true; return; }
  }
  if (config.mode === "finish" && !config.reclaim && board.flat().every((v) => v !== 0)) {
    winner = 0; gameOver = true;
  }
}

/* ------------------------------ Win checking ----------------------------- */
const LINES = [
  [[0, 0], [0, 1], [0, 2]], [[1, 0], [1, 1], [1, 2]], [[2, 0], [2, 1], [2, 2]],
  [[0, 0], [1, 0], [2, 0]], [[0, 1], [1, 1], [2, 1]], [[0, 2], [1, 2], [2, 2]],
  [[0, 0], [1, 1], [2, 2]], [[0, 2], [1, 1], [2, 0]],
];
function checkWin() {
  for (const line of LINES) {
    const [a, b, c] = line;
    const v = board[a[0]][a[1]];
    if (v !== 0 && v === board[b[0]][b[1]] && v === board[c[0]][c[1]]) return { winner: v, line };
  }
  return null;
}

/* -------------------------------- Ghosts --------------------------------- */
function frighten() { frightTimer = 7; }

// Ghost wall rules: door & cage interior only passable while returning/leaving.
function ghostCanMove(r, c, d, mode) {
  const nr = r + d.y, nc = c + d.x;
  if (r === TUNNEL_ROW && d.y === 0 && (nc < 0 || nc >= COLS)) return true; // tunnel mouth
  const x = ch(nr, nc);
  if (x === "#") return false;
  if (x === "=" || x === " ") return mode === "eaten" || mode === "leaving";
  return true;
}

function playerTileDist(g, p) {
  const a = nearestTile(g), b = nearestTile(p);
  return Math.hypot(a.r - b.r, a.c - b.c);
}

function ghostTarget(g) {
  if (g.mode === "eaten") return CAGE_HOME;
  let near = null, nd = Infinity;
  for (const p of players) { const d = playerTileDist(g, p); if (d < nd) { nd = d; near = p; } }
  if (frightTimer > 0) return g.scatter; // (frightened picks randomly anyway)
  if (near && nd <= 9) return nearestTile(near); // chase when close
  return g.scatter;                              // otherwise patrol a corner
}

function chooseGhostDir(g, r, c) {
  const dirs = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
  let opts = dirs.filter((d) => ghostCanMove(r, c, d, g.mode));
  const rev = { x: -g.dir.x, y: -g.dir.y };
  const noRev = opts.filter((d) => !(d.x === rev.x && d.y === rev.y));
  if (noRev.length) opts = noRev;
  if (!opts.length) return { x: rev.x, y: rev.y };

  if (frightTimer > 0 && g.mode !== "eaten") return opts[Math.floor(Math.random() * opts.length)];

  const t = ghostTarget(g);
  let best = opts[0], bd = Infinity;
  for (const d of opts) {
    const dist = (r + d.y - t.r) ** 2 + (c + d.x - t.c) ** 2;
    if (dist < bd) { bd = dist; best = d; }
  }
  return best;
}

function ghostSpeed(g) {
  if (g.mode === "eaten") return 3.2;
  if (frightTimer > 0) return 1.1;
  return g.speed;
}

function updateGhost(g, dt) {
  if (g.mode === "caged") {
    // bob in place, then release on schedule
    g.y = g.homeY + Math.sin(clock * 4 + g.i) * 3;
    if (clock >= g.releaseAt) { g.mode = "leaving"; g.x = g.homeX; g.y = g.homeY; }
    return;
  }
  if (g.mode === "leaving") {
    const step = 1.6 * dt;
    const ex = tileCenter(CAGE_EXIT.r, CAGE_EXIT.c).x;
    const ey = tileCenter(CAGE_EXIT.r, CAGE_EXIT.c).y;
    if (Math.abs(g.x - ex) > 0.5) g.x = approach(g.x, ex, step);
    else if (Math.abs(g.y - ey) > 0.5) g.y = approach(g.y, ey, step);
    else { g.mode = "active"; g.dir = { x: -1, y: 0 }; }
    return;
  }

  const step = ghostSpeed(g) * dt;
  const { r: cr, c: cc } = nearestTile(g);
  const { x: cenx, y: ceny } = tileCenter(cr, cc);

  if (g.mode === "eaten" && cr === CAGE_HOME.r && cc === CAGE_HOME.c &&
      Math.abs(g.x - cenx) <= step && Math.abs(g.y - ceny) <= step) {
    g.mode = "caged"; g.x = g.homeX; g.y = g.homeY;
    g.releaseAt = clock + 1.5; g.dir = { x: 0, y: -1 };
    return;
  }

  const atCenter = Math.abs(g.x - cenx) <= step && Math.abs(g.y - ceny) <= step;
  if (atCenter) { g.x = cenx; g.y = ceny; g.dir = chooseGhostDir(g, cr, cc); }

  if (!ghostCanMove(cr, cc, g.dir, g.mode)) { g.dir = chooseGhostDir(g, cr, cc); }
  g.x += g.dir.x * step; g.y += g.dir.y * step;
  if (g.dir.x !== 0) g.y = ceny;
  if (g.dir.y !== 0) g.x = cenx;
  wrapTunnel(g);
}

function handleGhostCollisions() {
  for (const g of ghosts) {
    if (g.mode === "caged" || g.mode === "leaving" || g.mode === "eaten") continue;
    for (const p of players) {
      if (p.stall > 0 || p.invuln > 0) continue; // immune while frozen / just after
      if (Math.hypot(p.x - g.x, p.y - g.y) > p.r + g.r - 4) continue;
      if (frightTimer > 0) {
        g.mode = "eaten"; g.dir = { x: 0, y: -1 };
      } else if (config.stall) {
        p.stall = 2; p.dir = { x: 0, y: 0 }; // freeze in place for 2s
      } else {
        const s = tileCenter(p.spawnR, p.spawnC); // back to your start tile
        p.x = s.x; p.y = s.y; p.dir = { x: 0, y: 0 };
      }
    }
  }
}

/* -------------------------------- Rendering ------------------------------ */
function draw(time) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawRegionsTint();
  drawWalls();
  drawGridLines();
  drawClaimMarks();
  drawDots(time);
  drawRegionProgress();
  for (const p of players) drawPacman(p, time);
  for (const g of ghosts) drawGhost(g, time);
  if (winLine) drawWinLine();
  if (gameOver) drawOverlay();
}

// Neon, hollow walls (OG Pac-Man look): trace a glowing line along each wall
// mass's edges that face open space. Cached to an offscreen layer since the
// maze never changes -- avoids paying the glow cost every frame.
let wallLayer = null;
function buildWallLayer() {
  wallLayer = document.createElement("canvas");
  wallLayer.width = canvas.width;
  wallLayer.height = canvas.height;
  const g = wallLayer.getContext("2d");
  g.lineCap = "round";
  g.lineJoin = "round";
  const m = 5; // inset from the tile edge
  const path = new Path2D();
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (!isWall(r, c)) continue;
    const x0 = c * TILE, y0 = r * TILE, x1 = x0 + TILE, y1 = y0 + TILE;
    const oN = !isWall(r - 1, c), oS = !isWall(r + 1, c), oE = !isWall(r, c + 1), oW = !isWall(r, c - 1);
    const L = x0 + (oW ? m : 0), R = x1 - (oE ? m : 0), T = y0 + (oN ? m : 0), B = y1 - (oS ? m : 0);
    if (oN) { path.moveTo(L, y0 + m); path.lineTo(R, y0 + m); }
    if (oS) { path.moveTo(L, y1 - m); path.lineTo(R, y1 - m); }
    if (oW) { path.moveTo(x0 + m, T); path.lineTo(x0 + m, B); }
    if (oE) { path.moveTo(x1 - m, T); path.lineTo(x1 - m, B); }
  }
  // Three passes for a bright neon-tube glow: wide halo -> mid -> light core.
  g.shadowColor = "#6aa8ff"; g.shadowBlur = 14;
  g.strokeStyle = "#3f7bff"; g.lineWidth = 3.4; g.stroke(path);
  g.shadowBlur = 7;
  g.strokeStyle = "#6ea0ff"; g.lineWidth = 2.0; g.stroke(path);
  g.shadowBlur = 0;
  g.strokeStyle = "#d6e6ff"; g.lineWidth = 1.0; g.stroke(path);
}
function drawWalls() {
  if (!wallLayer) buildWallLayer();
  ctx.drawImage(wallLayer, 0, 0);
}

function drawGridLines() {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.32)";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 8]);
  for (const c of [COL_EDGES[1], COL_EDGES[2]]) {
    ctx.beginPath(); ctx.moveTo(c * TILE, 0); ctx.lineTo(c * TILE, canvas.height); ctx.stroke();
  }
  for (const r of [ROW_EDGES[1], ROW_EDGES[2]]) {
    ctx.beginPath(); ctx.moveTo(0, r * TILE); ctx.lineTo(canvas.width, r * TILE); ctx.stroke();
  }
  ctx.restore();
}

function regionRect(rr, cc) {
  return {
    x: COL_EDGES[cc] * TILE, y: ROW_EDGES[rr] * TILE,
    w: (COL_EDGES[cc + 1] - COL_EDGES[cc]) * TILE,
    h: (ROW_EDGES[rr + 1] - ROW_EDGES[rr]) * TILE,
  };
}

function drawRegionsTint() {
  for (let rr = 0; rr < 3; rr++) for (let cc = 0; cc < 3; cc++) {
    const owner = board[rr][cc];
    if (!owner) continue;
    const b = regionRect(rr, cc);
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = COLORS[owner];
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.restore();
  }
}

function drawClaimMarks() {
  for (let rr = 0; rr < 3; rr++) for (let cc = 0; cc < 3; cc++) {
    const owner = board[rr][cc];
    if (!owner) continue;
    const cen = regionCenterPx(rr, cc);
    const s = TILE * 1.7;
    ctx.save();
    ctx.strokeStyle = COLORS[owner];
    ctx.lineWidth = 9;
    ctx.lineCap = "round";
    ctx.shadowColor = COLORS[owner];
    ctx.shadowBlur = 16;
    if (owner === 1) {           // X
      ctx.beginPath();
      ctx.moveTo(cen.x - s, cen.y - s); ctx.lineTo(cen.x + s, cen.y + s);
      ctx.moveTo(cen.x + s, cen.y - s); ctx.lineTo(cen.x - s, cen.y + s);
      ctx.stroke();
    } else if (owner === 2) {    // O
      ctx.beginPath(); ctx.arc(cen.x, cen.y, s, 0, Math.PI * 2); ctx.stroke();
    } else {                     // triangle (P3)
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(cen.x, cen.y - s);
      ctx.lineTo(cen.x + s * 0.92, cen.y + s * 0.7);
      ctx.lineTo(cen.x - s * 0.92, cen.y + s * 0.7);
      ctx.closePath(); ctx.stroke();
    }
    ctx.restore();
  }
}

function drawDots(time) {
  const percent = config.mode === "percent";
  const pulse = 1 + 0.18 * Math.sin(time / 150);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (!dots[r][c]) continue;
    const owner = percent ? dotOwner[r][c] : 0;
    const cen = tileCenter(r, c);
    ctx.fillStyle = owner ? COLORS[owner] : DOT_NEUTRAL;
    if (isBig[r][c]) {
      ctx.beginPath(); ctx.arc(cen.x, cen.y, 6 * pulse, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(cen.x, cen.y, owner ? 3.4 : 2.6, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawPacman(p, time) {
  const moving = p.dir.x !== 0 || p.dir.y !== 0;
  const open = moving ? (0.18 + 0.22 * Math.abs(Math.sin(time / 90))) : 0.06;
  const angle = Math.atan2(p.faceY, p.faceX);
  ctx.save();
  // Frozen by a ghost: blink to show the 2s stall.
  if (p.stall > 0) ctx.globalAlpha = 0.35 + 0.35 * Math.abs(Math.sin(time / 90));
  ctx.translate(p.x, p.y);
  ctx.rotate(angle);
  ctx.fillStyle = p.color;
  ctx.shadowColor = p.color;
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, p.r, open * Math.PI, (2 - open) * Math.PI);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.shadowBlur = 0;
}

function drawGhost(g, time) {
  const eaten = g.mode === "eaten";
  const fright = frightTimer > 0 && !eaten && g.mode === "active";
  const x = g.x, y = g.y, r = g.r;

  if (!eaten) {
    let body = g.color;
    if (fright) {
      // flash near the end of frightened time
      body = (frightTimer < 2 && Math.floor(time / 200) % 2 === 0) ? "#ffffff" : FRIGHT_COLOR;
    }
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(x, y - r * 0.15, r * 0.9, Math.PI, 0);
    const baseY = y + r * 0.85;
    ctx.lineTo(x + r * 0.9, baseY);
    const feet = 4, w = (r * 1.8) / feet;
    for (let i = 0; i < feet; i++) {
      const fx = x + r * 0.9 - w * i;
      ctx.lineTo(fx - w / 2, baseY - r * 0.28);
      ctx.lineTo(fx - w, baseY);
    }
    ctx.closePath();
    ctx.fill();
  }

  // eyes (always; eaten ghost = just eyes)
  const dirx = g.dir.x, diry = g.dir.y;
  for (const sx of [-1, 1]) {
    const ex = x + sx * r * 0.35, ey = y - r * 0.1;
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.ellipse(ex, ey, r * 0.26, r * 0.32, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = fright ? "#ffffff" : "#1a1aff";
    ctx.beginPath();
    ctx.arc(ex + dirx * r * 0.12, ey + diry * r * 0.12, r * 0.14, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Small per-region indicator so it's clear how close each square is to being
// claimed: dots remaining (First-to-Finish) or leading % (Percent mode).
function drawRegionProgress() {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 13px 'Courier New', monospace";
  for (let rr = 0; rr < 3; rr++) for (let cc = 0; cc < 3; cc++) {
    if (board[rr][cc] !== 0) continue; // claimed regions show their X / O
    const cen = regionCenterPx(rr, cc);
    let label, color = "rgba(255,255,255,0.30)";
    if (config.mode === "percent") {
      const T = dotsTotalPerCell[rr][cc] || 1;
      let lead = 0, leadId = 0, tie = false;
      for (const id of activeIds) {
        const v = paint[id][rr][cc];
        if (v > lead) { lead = v; leadId = id; tie = false; }
        else if (v === lead && v > 0) tie = true;
      }
      label = Math.round((100 * lead) / T) + "%";
      if (leadId && !tie) color = hexToRgba(COLORS[leadId], 0.55);
    } else {
      label = dotsRemaining[rr][cc] + "";
    }
    ctx.fillStyle = color;
    ctx.fillText(label, cen.x, cen.y);
  }
  ctx.restore();
}

function drawWinLine() {
  const a = regionCenterPx(winLine[0][0], winLine[0][1]);
  const b = regionCenterPx(winLine[2][0], winLine[2][1]);
  ctx.save();
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 7; ctx.lineCap = "round";
  ctx.shadowColor = "#fff"; ctx.shadowBlur = 18;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.restore();
}

function drawOverlay() {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.74)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  let title, color;
  if (winner === 0) { title = "DRAW!"; color = "#fff"; }
  else { title = `PLAYER ${winner} WINS!`; color = COLORS[winner]; }
  ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 22;
  ctx.font = "bold 34px 'Courier New', monospace";
  ctx.fillText(title, canvas.width / 2, canvas.height / 2 - 22);
  ctx.shadowBlur = 0; ctx.fillStyle = "#cfcfe6";
  ctx.font = "14px 'Courier New', monospace";
  ctx.fillText("ENTER / SPACE — rematch", canvas.width / 2, canvas.height / 2 + 26);
  ctx.fillText("S — change settings", canvas.width / 2, canvas.height / 2 + 48);
  ctx.restore();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* --------------------------------- HUD ----------------------------------- */
function updateHud() {
  const s = { 1: 0, 2: 0, 3: 0 };
  for (const row of board) for (const v of row) if (v) s[v]++;
  for (const id of ALL_IDS) {
    const el = document.getElementById("score" + id);
    if (el) el.textContent = s[id];
  }
}

// Show the P3 HUD card only in 3-player mode.
function syncPlayerCards() {
  const c3 = document.querySelector(".p3-card");
  if (c3) c3.style.display = config.players === 3 ? "" : "none";
}

/* ------------------------- Setup screen wiring --------------------------- */
const startScreen = document.getElementById("start-screen");
const playersSeg = document.getElementById("players-seg");
const modeSeg = document.getElementById("mode-seg");
const modeHint = document.getElementById("mode-hint");
const reclaimToggle = document.getElementById("reclaim-toggle");
const strengthToggle = document.getElementById("strength-toggle");
const collideToggle = document.getElementById("collide-toggle");
const ghostsToggle = document.getElementById("ghosts-toggle");
const stallToggle = document.getElementById("stall-toggle");

const MODE_HINTS = {
  finish: "Eat every dot in a square to claim it.",
  percent: "Paint dots by passing over them — own 75% of a square to claim it. Recolour to steal it back.",
};

playersSeg.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-players]");
  if (!btn) return;
  config.players = +btn.dataset.players;
  if (!started) resetGame(); // rebuild the on-canvas roster for the preview
  syncSettingsUI();
});
modeSeg.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-mode]");
  if (!btn) return;
  config.mode = btn.dataset.mode;
  syncSettingsUI();
});
reclaimToggle.addEventListener("click", () => {
  if (reclaimToggle.disabled) return;
  config.reclaim = !config.reclaim;
  syncSettingsUI();
});
strengthToggle.addEventListener("click", () => {
  config.strength = !config.strength;
  syncSettingsUI();
});
collideToggle.addEventListener("click", () => {
  config.collide = !config.collide;
  syncSettingsUI();
});
ghostsToggle.addEventListener("click", () => {
  config.ghosts = !config.ghosts;
  syncSettingsUI();
});
stallToggle.addEventListener("click", () => {
  if (stallToggle.disabled) return;
  config.stall = !config.stall;
  syncSettingsUI();
});
document.getElementById("start-btn").addEventListener("click", startGame);

function syncSettingsUI() {
  [...playersSeg.children].forEach((b) => b.classList.toggle("active", +b.dataset.players === config.players));
  syncPlayerCards();
  [...modeSeg.children].forEach((b) => b.classList.toggle("active", b.dataset.mode === config.mode));
  modeHint.textContent = MODE_HINTS[config.mode];

  const percent = config.mode === "percent";
  reclaimToggle.disabled = percent;
  if (percent) { reclaimToggle.classList.add("on"); reclaimToggle.textContent = "ALWAYS ON"; }
  else { reclaimToggle.classList.toggle("on", config.reclaim); reclaimToggle.textContent = config.reclaim ? "ON" : "OFF"; }

  strengthToggle.classList.toggle("on", config.strength);
  strengthToggle.textContent = config.strength ? "ON" : "OFF";

  collideToggle.classList.toggle("on", config.collide);
  collideToggle.textContent = config.collide ? "ON" : "OFF";

  ghostsToggle.classList.toggle("on", config.ghosts);
  ghostsToggle.textContent = config.ghosts ? "ON" : "OFF";

  // Ghost Stall only does anything when ghosts are enabled.
  stallToggle.disabled = !config.ghosts;
  stallToggle.parentElement.classList.toggle("dim", !config.ghosts);
  stallToggle.classList.toggle("on", config.stall && config.ghosts);
  stallToggle.textContent = config.stall ? "ON" : "OFF";
}

/* --------------------------------- Audio --------------------------------- */
// Silly 8-bit mbira-inspired music: an interlocking, cyclic pentatonic
// ostinato (kushaura + kutsinhira style) built live with the Web Audio API.
// Tempo speeds up as more dots are eaten and goes double-time when a player
// is one square from winning.
const audio = { ctx: null, master: null, on: true };
let musicStep = 0, musicNextTime = 0;
let nearWinActive = false;

// A 16-bar theme in G major over a I-V-vi-IV axis progression, shaped as
// A / A' / B / A'' so a recognisable melody keeps returning while no two
// consecutive bars are identical. Each bar = 8 eighth-note steps (0 = rest).
// It DEVELOPS via instrument layering tied to game progress (see musicLevel).
const CHORDS = {
  G:  { bass: 55, tri: [55, 59, 62] }, // G  B  D
  D:  { bass: 50, tri: [54, 57, 62] }, // F# A  D
  Em: { bass: 52, tri: [55, 59, 64] }, // G  B  E
  C:  { bass: 48, tri: [60, 64, 67] }, // C  E  G
};
const SONG = [
  // A — the main theme
  { ch: "G",  mel: [79, 0, 76, 0, 74, 0, 71, 0] },
  { ch: "D",  mel: [69, 0, 71, 0, 74, 0, 0, 0] },
  { ch: "Em", mel: [76, 0, 74, 0, 71, 0, 67, 0] },
  { ch: "C",  mel: [74, 0, 76, 0, 79, 0, 0, 0] },
  // A' — answered with ornament
  { ch: "G",  mel: [79, 81, 79, 76, 0, 74, 0, 71] },
  { ch: "D",  mel: [74, 0, 71, 0, 69, 0, 66, 0] },
  { ch: "Em", mel: [71, 0, 76, 0, 79, 0, 76, 0] },
  { ch: "C",  mel: [76, 0, 74, 0, 72, 0, 0, 0] },
  // B — lift / bridge
  { ch: "Em", mel: [71, 74, 76, 79, 0, 0, 76, 0] },
  { ch: "C",  mel: [79, 0, 76, 0, 74, 0, 76, 0] },
  { ch: "G",  mel: [74, 0, 79, 0, 78, 0, 76, 0] },
  { ch: "D",  mel: [69, 0, 74, 0, 78, 0, 81, 0] },
  // A'' — restate & cadence back to the top
  { ch: "G",  mel: [79, 0, 76, 0, 74, 0, 71, 0] },
  { ch: "D",  mel: [69, 0, 71, 0, 74, 0, 0, 0] },
  { ch: "Em", mel: [76, 0, 74, 0, 71, 0, 67, 0] },
  { ch: "C",  mel: [74, 0, 76, 0, 74, 0, 67, 0] },
];

function initAudio() {
  if (audio.ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  audio.ctx = new AC();
  audio.master = audio.ctx.createGain();
  audio.master.gain.value = 0.14;
  audio.master.connect(audio.ctx.destination);
}
function resumeAudio() { if (audio.ctx && audio.ctx.state === "suspended") audio.ctx.resume(); }
const midiFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

function pluck(freq, time, dur, type, gain) {
  const c = audio.ctx;
  const o = c.createOscillator();
  o.type = type; o.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, time);
  g.gain.linearRampToValueAtTime(gain, time + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0008, time + dur);
  o.connect(g); g.connect(audio.master);
  o.start(time); o.stop(time + dur + 0.03);
}

function musicProgress() {
  let total = 0, done = 0;
  for (let rr = 0; rr < 3; rr++) for (let cc = 0; cc < 3; cc++) {
    const T = dotsTotalPerCell[rr][cc];
    total += T;
    if (config.mode === "percent") {
      for (const id of activeIds) done += paint[id][rr][cc];
    } else {
      done += T - dotsRemaining[rr][cc];
    }
  }
  return total ? done / total : 0;
}
function computeNearWin() {
  for (const line of LINES) {
    const counts = {};
    let e = 0;
    for (const [r, c] of line) { const v = board[r][c]; if (v === 0) e++; else counts[v] = (counts[v] || 0) + 1; }
    if (e === 1 && Object.values(counts).some((n) => n === 2)) return true;
  }
  return false;
}
function stepDuration() {
  let d = 0.165 * (1 - 0.42 * musicProgress()); // faster as dots vanish
  if (nearWinActive) d *= 0.5;                   // double-time near a win
  return Math.max(0.055, d);
}
// Density grows with progress: 1 = melody+bass (gentle intro), 2 = + walking
// bass & interlocking harmony, 3 = full climax with octave shimmer. A player
// one square from winning forces the climax.
function musicLevel() {
  const p = musicProgress();
  let lvl = p < 0.34 ? 1 : p < 0.67 ? 2 : 3;
  if (nearWinActive) lvl = 3;
  return lvl;
}

function playStep(step, time, dur) {
  const measure = Math.floor(step / 8) % SONG.length;
  const s = step % 8;
  const bar = SONG[measure];
  const chord = CHORDS[bar.ch];
  const level = musicLevel();

  const mnote = bar.mel[s];
  if (mnote) {
    pluck(midiFreq(mnote), time, dur * 1.6, "square", 0.16);
    if (level >= 3) pluck(midiFreq(mnote + 12), time, dur * 1.0, "square", 0.045); // shimmer
  }

  // bass
  if (s === 0) pluck(midiFreq(chord.bass), time, dur * 2.2, "triangle", 0.22);
  else if (s === 4) pluck(midiFreq(chord.bass + 7), time, dur * 2.0, "triangle", 0.20);
  else if (level >= 2 && s === 2) pluck(midiFreq(chord.bass), time, dur * 1.4, "triangle", 0.15);
  else if (level >= 2 && s === 6) pluck(midiFreq(chord.bass + 7), time, dur * 1.4, "triangle", 0.15);

  // interlocking harmony arpeggio (mbira style) on the off-beats
  if (level >= 2 && s % 2 === 1) {
    const idx = (s - 1) / 2 % 3;
    pluck(midiFreq(chord.tri[idx]), time, dur * 1.3, "square", 0.07);
  }
  if (level >= 3 && (s === 2 || s === 6)) {
    const idx = (s / 2) % 3;
    pluck(midiFreq(chord.tri[idx] + 12), time, dur * 0.9, "square", 0.04);
  }
}
function audioScheduler() {
  if (!audio.ctx || !audio.on) return;
  if (!(started && !gameOver)) { musicNextTime = audio.ctx.currentTime; return; }
  const t = audio.ctx.currentTime;
  if (musicNextTime < t) musicNextTime = t + 0.03;
  while (musicNextTime < t + 0.1) {
    const d = stepDuration();
    playStep(musicStep++, musicNextTime, d);
    musicNextTime += d;
  }
}
setInterval(audioScheduler, 25);

/* ------------------------------- Main loop ------------------------------- */
let lastTime = performance.now();
function loop(now) {
  const dt = Math.min((now - lastTime) / (1000 / 60), 3);
  lastTime = now;

  if (started && !gameOver) {
    clock += dt / 60;
    if (frightTimer > 0) frightTimer = Math.max(0, frightTimer - dt / 60);
    for (const p of players) updatePlayer(p, dt);
    for (const g of ghosts) updateGhost(g, dt);
    if (ghosts.length) handleGhostCollisions();
    nearWinActive = computeNearWin();
  } else {
    nearWinActive = false;
  }
  draw(now);
  requestAnimationFrame(loop);
}

resetGame();
started = false;
syncSettingsUI();
requestAnimationFrame(loop);
