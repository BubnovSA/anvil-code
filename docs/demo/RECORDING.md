# Recording the README demo gif

`README.md` references `assets/demo.gif`. This guide gives two ways to produce it.

## Option A — automated terminal recording with `vhs` (fast, reproducible)

[vhs](https://github.com/charmbracelet/vhs) is a CLI that runs a `.tape` script and outputs a gif. The result shows the SSE event stream of a real task — same content the VSCode extension renders, just in the terminal.

```bash
# 1. Install vhs (macOS)
brew install vhs ffmpeg

# 2. Start the Anvil-Code API server in another terminal
#    (assumes llama-swap is already running on :8080)
npm run start

# 3. Pre-register a project the tape will hit
curl -X POST http://localhost:3000/project \
  -H "Content-Type: application/json" \
  -d "{\"root\": \"$(pwd)/rag-system-sandbox\"}"
# → save the returned id into anvil-demo.tape (PROJECT_ID placeholder)

# 4. Record
vhs docs/demo/anvil-demo.tape
# → produces docs/demo/anvil-demo.gif

# 5. Promote to the README path
cp docs/demo/anvil-demo.gif assets/demo.gif
```

The tape is fully scripted: it submits a task, opens the SSE stream, and waits for `commit`. Re-running gives byte-similar output (modulo task duration), so you can keep the gif fresh between releases.

## Option B — VSCode UI capture (polished, manual)

This is the gif most projects ship. Uses macOS's built-in screen recorder + ffmpeg / gifski for conversion.

### Prep

1. Open the target repo in VSCode.
2. Install `.vsix`: **Extensions → ⋯ → Install from VSIX…** → `packages/vscode-extension/anvil-code-vscode-*.vsix`.
3. Open the **Anvil-Code** sidebar (rocket icon in Activity Bar). Make sure a project is registered and indexed.
4. Open the **Output → Anvil-Code** panel at the bottom — that's where the SSE stream lands. Set a comfortable font size.
5. Set window to a fixed size — 1280×800 is a good compromise between detail and final gif size.
6. Pick a short, photogenic task (something that commits within 60–90 s). Examples:
   - `Add a request-id middleware that injects x-request-id`
   - `Add JSDoc to the export const Hono = ... constructor`
   - `Add a count() helper for params`

### Record (macOS)

```bash
# QuickTime Player → File → New Screen Recording → Record selected area
# Frame the VSCode window only. Stop recording right after the commit toast.
# Save as anvil-demo.mov (in docs/demo/).
```

### Convert to gif

Two paths — `gifski` gives smaller, sharper output; `ffmpeg` is universally available.

```bash
# Path 1: ffmpeg + palette (universal)
ffmpeg -i docs/demo/anvil-demo.mov \
  -vf "fps=12,scale=820:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
  -loop 0 docs/demo/anvil-demo.gif

# Path 2: gifski (sharper, smaller — needs `brew install gifski ffmpeg`)
ffmpeg -i docs/demo/anvil-demo.mov -vf "fps=12,scale=820:-1:flags=lanczos" docs/demo/frames-%04d.png
gifski -o docs/demo/anvil-demo.gif docs/demo/frames-*.png
rm docs/demo/frames-*.png

# Promote
cp docs/demo/anvil-demo.gif assets/demo.gif
```

Target: ≤ 8 MB. GitHub will display anything but a 30 MB gif kills the README load time. If too big:
- Drop `fps` to 10.
- Drop `scale` to 720.
- Trim leading/trailing dead time with `-ss <start> -to <end>` in the ffmpeg input.

## What the gif should show

Single take, no cuts:

1. Hit **Anvil-Code: Submit Task** in the command palette (~1 s)
2. Pick the project (~1 s)
3. Type the task description (~3 s)
4. Pick `balanced` mode
5. Output channel scrolls: `plan → step_start → coder_file_ready → validation_pass → commit`
6. Toast bottom-right: `Anvil-Code task <hash> committed N files @ <commitHash>`

Total: 60–90 s wall clock, ~15–25 s gif at 12 fps with judicious trimming.

## After capture

Once `assets/demo.gif` exists, the existing `<img src="assets/demo.gif">` in [README.md](../../README.md#L26) renders it. No README edit needed.
