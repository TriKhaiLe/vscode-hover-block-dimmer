# HoverBlock Dimmer (Line & Block Focus)

Keep the hovered or active code block at full brightness while dimming or blurring surrounding lines in two smooth tiers (`nearDecoration` and `dimDecoration`).

## Features

- **2-Tier Block Spotlight (`nearDecoration` + `dimDecoration`)**:
  - Focused block / active lines keep full brightness with no decoration overlay.
  - Adjacent border lines (`hoverBlockDimmer.nearLines`, default `1`) are slightly dimmed (`hoverBlockDimmer.nearOpacity`, default `0.55`).
  - All outer lines are strongly dimmed (`hoverBlockDimmer.dimOpacity`, default `0.22`).
- **Mouse Hover + Cursor Tracking (`hoverBlockDimmer.triggerMode`)**: Supports `cursorAndHover`, `hoverOnly`, or `cursorOnly`.
  > Note: VS Code tracks mouse hover via the `HoverProvider` API after `editor.hover.delay` (default ~300ms). Use the HoverBlock Dimmer quick menu to set `editor.hover.delay` to `50ms` for near-instant hover spotlighting.
- **Multiple Focus Scopes (`hoverBlockDimmer.focusScope`)**: Switch between **Code Block** (`block`, capped by `hoverBlockDimmer.maxBlockLines`), **Paragraph** (`paragraph`), and **1 Line** (`line`).
- **Flexible Visual Effects (`hoverBlockDimmer.effectStyle`)**:
  - `dimOnly` (default): 2-tier opacity dimming (`nearDecoration` + `dimDecoration`)
  - `dimAndBlur`: Dim opacity and blur unfocused lines
  - `blurOnly`: Blur unfocused lines only
  - `gradient`: Progressive 3-band falloff (`near`, `mid`, `dim`) away from the focused block
- **Quick Menu & Keybinding**: Press `Ctrl+Alt+F` (`Cmd+Alt+F` on macOS) or click the Status Bar item `$(eye) Focus: ...` to toggle or configure presets and modes on the fly.

## Install from `.vsix`

1. Build or locate `vscode-hover-block-dimmer-0.1.0.vsix`.
2. In VS Code / Antigravity, open Extensions (`Ctrl+Shift+X`) -> `...` -> **Install from VSIX...**, or run:
   ```powershell
   agy --install-extension vscode-hover-block-dimmer-0.1.0.vsix
   ```
