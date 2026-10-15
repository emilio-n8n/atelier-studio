# Atelier

A clean editing studio for the Gradio apps that run in your Kaggle and Colab notebooks. Paste each notebook's public link (`*.gradio.live` or `*.trycloudflare.com`), generate images, videos and voices from one interface, then cut them together on a timeline and export.

Everything happens in the browser: the studio calls each notebook's Gradio API directly (`@gradio/client`), keeps the generated media in IndexedDB (so it survives the notebook session), and renders the export with `MediaRecorder`. No backend, no API keys.

## Supported notebooks (v0.1)

| Model | Kind | Notebook | Endpoints used |
| --- | --- | --- | --- |
| FLUX 3 Image Klein | image | Kaggle T4 x2 · `flux-3-image-klein-t4.ipynb` | `/t2i`, `/edit` |
| Qwen-Image 2.1 Uncensored INT8 | image | Colab T4 · `Qwen_Image_2_1_Uncensored_INT8_Colab_by_AIQUEST.ipynb` | `/generate_image` (+ `/aiq_progress`) |
| MiniMax H3 Turbo INT8 | video + audio | Kaggle T4 x2 · `minimax-h3-turbo-int8-video-audio.ipynb` | `/start_generation`, `/poll_job` (+ `/aiq_progress`, `/aiq_video`) |
| Fish Audio Drama 3 int4 | voice | Kaggle T4 x2 · `fish-audio-drama-3-int4-t4.ipynb` | `/run` |
| OmniVoice | voice | Colab T4 · `OmniVoice_TTS_By_AIQUEST.ipynb` | `/clone_fn`, `/design_fn` |

Every parameter the notebook UI exposes is in the studio, with the same choices, ranges and defaults (see `src/lib/models.ts`):

- **FLUX 3 Klein**: text-to-image or edit with 1-10 references, 7 sizes (or "same as first reference"), 4-32 steps, seed.
- **Qwen-Image 2.1**: create, edit / multi-reference (10), inpaint (built-in mask painter, strength), outpaint (target ratio + 4 margins), 4 modes (Viggle 6 steps, Pruna 8, Alibaba 4, Quality + CFG with negative prompt, steps, guidance), transparent PNG, style preset, resolution, aspect ratio, 1-4 images, seed.
- **MiniMax H3 Turbo**: scene, spoken line + language (15), sound effects, music, resolution, aspect, duration (3-15 s), quality preset, seed, start / end frames, 3 references + names + voice reference (Ref2VA variants), 2 catalogue LoRAs + a custom LoRA URL with strengths, auto trigger words, sampler, flow shift, custom steps.
- **Drama 3**: script with bracket directions and `<|speaker:N|>`, voice cloning (clip + exact transcript), temperature, top-p, max frames per chunk, seed, single pass.
- **OmniVoice**: voice clone (reference + optional transcript) or voice design (gender, age, pitch, style, English accent, Chinese dialect), 21 languages, steps, guidance, denoise, speed, duration, pre/post-processing.

## Editing

- Media bin: drag files in, or get generations automatically. Any result can feed the next generation ("Use as" → FLUX reference, MiniMax start frame, Drama 3 voice…), or restore the exact settings that produced it.
- Timeline: video lanes (V2 draws over V1) and audio lanes, drag and drop, move between lanes, trim both edges, split at the playhead (`S`), snapping, zoom (`Ctrl/⌘ + wheel`), per-clip volume and fit, per-lane mute / hide.
- Viewer: program monitor (Space to play, ←/→ frame by frame, Shift for seconds) and a source monitor for any media.
- Export: 16:9, 9:16 or 1:1, real-time render to MP4 where the browser can record it (WebM otherwise).
- Generation queue with live progress (Gradio progress events, plus `/aiq_progress` on the AIQUEST notebooks) and cancel.

## Run locally

```bash
npm install
npm run dev
```

## Deploy

It is a static Vite app: import the repo in Vercel (framework preset "Vite") or run `vercel --prod`.

## Notes

- Share links expire when the notebook session stops; paste the new one in **Connexions**.
- Gradio allows cross-origin calls on public links, which is what lets a static site drive the notebooks. A local `127.0.0.1` Gradio only accepts calls from a page served on localhost.
- Weights keep their own licences (FLUX Kommunity License for Klein, etc.).

## Agents (Claude Code, Codex) via MCP

`mcp/server.ts` is a stdio MCP server built on the same model specs as the studio. `npm run build:mcp` bundles it into `public/atelier-mcp.mjs`, served by the site.

```bash
mkdir -p ~/.atelier && curl -fsSL https://atelier-studio-pi.vercel.app/atelier-mcp.mjs -o ~/.atelier/atelier-mcp.mjs
claude mcp add --scope user atelier -- node ~/.atelier/atelier-mcp.mjs   # Claude Code
codex mcp add atelier -- node ~/.atelier/atelier-mcp.mjs                 # Codex
```

Tools: `list_models` (with every parameter), `set_connection` (saves a Gradio link to `~/.atelier/connections.json`), `generate` (local paths/URLs as inputs, files saved to `./atelier-output` or `$ATELIER_OUT_DIR`), `get_job`, `cancel_job`. Links can also come from `ATELIER_FLUX_URL`, `ATELIER_QWEN_URL`, `ATELIER_MINIMAX_URL`, `ATELIER_DRAMA_URL`, `ATELIER_OMNIVOICE_URL`. The **Connexions** tab generates these commands with your current links.
