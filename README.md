# vscode-muse-chat — Muse Chat with LaTeX

VS Code extension that hosts **Muse Code** (`muse`, Meta Muse Spark) in a **webview** with **Markdown + LaTeX (KaTeX)** rendering.

* Command: **Muse Chat: Open Chat (LaTeX)** (`vscode-muse-chat.openChat`)
* View: Activity Bar → **Muse** → **Chat (LaTeX)**
* Backend: spawns `muse exec` per turn (workspace-aware, `--yolo` not required — approval still via TUI if needed). Streams `stdout` incrementally and renders with `marked` + `katex auto-render`.
* Math: `$...$` inline, `$$...$$` display — e.g. `$\theta_T = \sum b_t$`, `$$E[\theta_0]=E[T](2P[b_t=1]-1)$$` (§2.3.2).

## Dev

```bash
npm install
npm run compile      # or npm run watch
# F5 to launch Extension Development Host, or:
code --install-extension vscode-muse-chat-*.vsix
```

Requires `muse` on `PATH` (`~/.local/bin/muse`). Set `muse.path` in settings to override.

## Why

Muse's TUI is GitHub-flavored Markdown only — no LaTeX. This webview gives you MathJax/KaTeX rendering **in-chat** without dumping to `*.md` files.
