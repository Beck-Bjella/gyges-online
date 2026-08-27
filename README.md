# Gygès Online

An online site for playing [Gygès](https://en.wikipedia.org/wiki/Gyges_(board_game))
asynchronously against other players — correspondence-style, in the spirit of
Board Game Arena.

> **Status: rebuilding.** This repository previously held desktop UI clients
> (macroquad, Slint, Tauri) for the Gygès engine. Those have been removed to make
> room for the web application. The original macroquad app remains recoverable in
> git history at commit `82db53c`.

## What this is

- **Correspondence play.** Players take turns over hours or days. Nobody needs to
  be online at the same time. You get notified when it is your move.
- **Server-authoritative.** All game state and move validation live on the server.
  The browser renders the board and submits move *intents*; it is never trusted.
- **Accounts, ratings, and game history** for competitive play.

## What this is not (yet)

- Playing against the engine. The [Gygès engine](https://github.com/Beck-Bjella/Gyges)
  is a separate project and will be integrated later as an opponent option.
- Live realtime games with a clock.

## Documentation

- [docs/BOARD_REFERENCE.md](docs/BOARD_REFERENCE.md) — board topology, piece
  encoding, move format, notation, visual geometry, and color tokens, preserved
  from the desktop versions.

## License

GNU General Public License v3.0. See [LICENSE](LICENSE).
