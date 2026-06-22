# Tic-Pac-Man

A 2-player mashup of **Pac-Man** and **Tic-Tac-Toe**, played in the browser on
the classic Pac-Man maze. The maze is split into a 3×3 grid of scoring regions
— claim the squares by eating their dots, and get **three in a row** to win.

No build step, no dependencies — just open `index.html` (or play the hosted
version via GitHub Pages).

## Controls

| | Move | Claims |
|---|---|---|
| **Player 1** (yellow) | `W` `A` `S` `D` | yellow **X** |
| **Player 2** (red) | Arrow keys | red **O** |

- `M` — mute/unmute music
- `Enter` / `Space` — rematch (on the game-over screen)
- `S` — change settings (on the game-over screen)

## How to play

Pick options in the setup screen, then **three in a row wins**:

- **Game Mode**
  - **First to Finish** — eat every dot in a square to claim it.
  - **Percent (75%)** — dots get painted your colour as you pass over them; own
    75% of a square to claim it, recolour to steal it back.
- **Reclaimable Squares** (First-to-Finish only) — claimed squares refill so they
  can be stolen back.
- **Ghosts** — 4 ghosts leave the center cage and chase nearby players. Eat a
  **Big Pellet** (one per square) to turn them blue and edible. Get caught by a
  normal ghost and you respawn.

The more dots you eat than your opponent, the **faster and bigger** you get — so
aggressive play beats passively trailing to steal squares. The side tunnels wrap
around left↔right.

The soundtrack is generated live with the Web Audio API — an 8-bit, mbira-inspired
theme that layers up and speeds up as the game develops, going double-time when a
player is one square from winning.

## Tech

Vanilla HTML5 Canvas + JavaScript + the Web Audio API. No frameworks, no build.
