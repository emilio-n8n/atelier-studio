// Every model here mirrors the Gradio app its notebook launches: same endpoint, same inputs, same order,
// same choices and ranges. Values are the exact strings the notebook's dropdowns expect.

export type MediaKind = "image" | "video" | "audio";

export type Field =
  | { key: string; label: string; type: "text"; default: string; placeholder?: string; hint?: string; advanced?: boolean; showIf?: Cond }
  | { key: string; label: string; type: "textarea"; default: string; placeholder?: string; hint?: string; rows?: number; advanced?: boolean; showIf?: Cond; tags?: string[] }
  | { key: string; label: string; type: "select"; options: string[]; default: string; hint?: string; advanced?: boolean; showIf?: Cond; labels?: Record<string, string> }
  | { key: string; label: string; type: "segmented"; options: string[]; default: string; hint?: string; advanced?: boolean; showIf?: Cond; labels?: Record<string, string> }
  | { key: string; label: string; type: "slider"; min: number; max: number; step: number; default: number; hint?: string; advanced?: boolean; showIf?: Cond; unit?: string }
  | { key: string; label: string; type: "seed"; default: number; hint?: string; advanced?: boolean; showIf?: Cond }
  | { key: string; label: string; type: "checkbox"; default: boolean; hint?: string; advanced?: boolean; showIf?: Cond }
  | { key: string; label: string; type: "asset"; kind: MediaKind; default: null; hint?: string; advanced?: boolean; showIf?: Cond }
  | { key: string; label: string; type: "assets"; kind: MediaKind; max: number; default: string[]; hint?: string; advanced?: boolean; showIf?: Cond }
  | { key: string; label: string; type: "mask"; default: null; hint?: string; advanced?: boolean; showIf?: Cond };

export type Values = Record<string, unknown>;
type Cond = (v: Values) => boolean;

/** Files the payload builder needs: asset id -> File, provided by the job runner. */
export type FileResolver = (assetId: string | null | undefined) => Promise<File | null>;
export type MaskValue = { sourceId: string; mask: Blob } | null;

export interface RunPlan {
  endpoint: string;
  data: unknown[];
  /** "queue": normal Gradio call; "minimax-job": fire-and-poll through the notebook's own job runner. */
  style: "queue" | "minimax-job";
  output: MediaKind;
  label: string;
}

export interface ModelSpec {
  id: string;
  name: string;
  short: string;
  vendor: string;
  kind: MediaKind;
  hardware: string;
  notebookUrl: string;
  /** Endpoints the connection test must find. */
  endpoints: string[];
  blurb: string;
  fields: Field[];
  /** Has /aiq_progress (the AIQUEST notebooks expose live step progress there). */
  progressRoute?: boolean;
  speedHint: string;
  build(v: Values, file: FileResolver): Promise<RunPlan>;
}

const s = (v: unknown) => (v == null ? "" : String(v));
const n = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

// ───────────────────────────── FLUX 3 Image Klein (T4 x2) ─────────────────────────────
const KLEIN_SIZES = [
  "1024 × 1024 (1:1)", "1152 × 896 (4:3)", "896 × 1152 (3:4)", "1344 × 768 (16:9)",
  "768 × 1344 (9:16)", "1536 × 640 (21:9)", "768 × 768 (fast)",
];

const flux3: ModelSpec = {
  id: "flux3",
  name: "FLUX 3 Image Klein",
  short: "FLUX 3",
  vendor: "Black Forest Labs",
  kind: "image",
  hardware: "Kaggle · T4 x2",
  notebookUrl: "https://www.kaggle.com/code/emiliomoreau/flux-3-image-klein-on-t4-x2",
  endpoints: ["/t2i", "/edit"],
  blurb: "5,6B distillé, 16 étapes. Texte → image, édition et jusqu'à 10 références.",
  speedHint: "≈ 55 s en 1024 px · ≈ 2¼ min avec une référence",
  fields: [
    { key: "mode", label: "Mode", type: "segmented", options: ["t2i", "edit"], default: "t2i", labels: { t2i: "Texte → image", edit: "Édition / références" } },
    { key: "refs", label: "Images de référence", type: "assets", kind: "image", max: 10, default: [], showIf: (v) => v.mode === "edit", hint: "1 à 10 images, réduites à 1024 px max." },
    {
      key: "prompt", label: "Prompt", type: "textarea", rows: 5, default: "",
      placeholder: "Décris la scène entière : sujet, cadrage, décor, lumière. Les prompts courts donnent des images génériques.",
      hint: "En mode édition, décris l'image finale complète, modification incluse.",
    },
    { key: "size", label: "Format", type: "select", options: KLEIN_SIZES, default: "1024 × 1024 (1:1)", showIf: (v) => v.mode === "t2i" },
    { key: "editSize", label: "Format", type: "select", options: ["Same as first reference", ...KLEIN_SIZES], default: "Same as first reference", labels: { "Same as first reference": "Comme la 1re référence" }, showIf: (v) => v.mode === "edit" },
    { key: "steps", label: "Étapes", type: "slider", min: 4, max: 32, step: 1, default: 16, hint: "16 = réglage du modèle distillé." },
    { key: "seed", label: "Seed", type: "seed", default: -1 },
  ],
  async build(v, file) {
    if (v.mode === "edit") {
      const refs = (v.refs as string[]) ?? [];
      const files = (await Promise.all(refs.slice(0, 10).map(file))).filter(Boolean) as File[];
      if (!files.length) throw new Error("Ajoute au moins une image de référence.");
      return { endpoint: "/edit", style: "queue", output: "image", label: "FLUX 3 · édition",
        data: [files, s(v.prompt), s(v.editSize), n(v.steps, 16), n(v.seed, -1)] };
    }
    return { endpoint: "/t2i", style: "queue", output: "image", label: "FLUX 3 · texte → image",
      data: [s(v.prompt), s(v.size), n(v.steps, 16), n(v.seed, -1)] };
  },
};

// ───────────────────────────── Qwen-Image 2.1 (Colab T4) ─────────────────────────────
const Q_TASK = {
  create: "🖼️ Create (text → image)",
  refs: "🧩 Edit & Multi-Reference",
  inpaint: "🖌️ Inpaint (paint the area to change)",
  outpaint: "🔲 Outpaint (extend the image)",
};
const Q_MODES = [
  "✨ Turbo HQ · Viggle v0.2.1 · 6 steps (best fast quality)",
  "⚡ Turbo · Pruna v0.1 · 8 steps",
  "🚀 Turbo Fast · Alibaba Fun-Acc · 4 steps (fastest)",
  "🎨 Quality · base model + CFG (slow, follows prompts best)",
];
const Q_QUALITY = Q_MODES[3];

const qwen: ModelSpec = {
  id: "qwen",
  name: "Qwen-Image 2.1 Uncensored",
  short: "Qwen-Image",
  vendor: "Alibaba Qwen · INT8",
  kind: "image",
  hardware: "Colab · T4",
  notebookUrl: "https://colab.research.google.com/github/TeamAIQ/Colab-notebooks/blob/main/notebooks/Qwen_Image_2_1_Uncensored_INT8_Colab_by_AIQUEST.ipynb",
  endpoints: ["/generate_image"],
  progressRoute: true,
  blurb: "Création, édition multi-références (10), inpainting, outpainting et PNG transparents.",
  speedHint: "Turbo 4-8 étapes · chaque référence multiplie le temps (×2-3 avec une)",
  fields: [
    { key: "task", label: "Tâche", type: "segmented", options: ["create", "refs", "inpaint", "outpaint"], default: "create",
      labels: { create: "Créer", refs: "Éditer / réfs", inpaint: "Inpaint", outpaint: "Outpaint" } },
    { key: "refs", label: "Images (ordre = image 1, image 2…)", type: "assets", kind: "image", max: 10, default: [], showIf: (v) => v.task === "refs",
      hint: "Dans le prompt, désigne-les « image 1 », « image 2 »…" },
    { key: "mask", label: "Image et zone à repeindre", type: "mask", default: null, showIf: (v) => v.task === "inpaint", hint: "Peins la zone à changer." },
    { key: "strength", label: "Force du changement", type: "slider", min: 0.3, max: 1, step: 0.05, default: 1, showIf: (v) => v.task === "inpaint", hint: "1,0 régénère toute la zone peinte." },
    { key: "outpaintImage", label: "Image à étendre", type: "asset", kind: "image", default: null, showIf: (v) => v.task === "outpaint" },
    { key: "outpaintRatio", label: "Étendre vers", type: "select", showIf: (v) => v.task === "outpaint", default: "Custom margins (sliders)",
      options: ["Custom margins (sliders)", "16:9 Landscape", "9:16 Portrait", "1:1 Square", "4:3 Standard", "3:4 Portrait", "2:3 Poster", "21:9 Cinematic"],
      labels: { "Custom margins (sliders)": "Marges libres (curseurs)" }, hint: "Avec un ratio, les curseurs décident seulement où va l'espace ajouté." },
    { key: "outLeft", label: "Gauche", type: "slider", min: 0, max: 100, step: 5, default: 25, unit: "%", showIf: (v) => v.task === "outpaint" },
    { key: "outRight", label: "Droite", type: "slider", min: 0, max: 100, step: 5, default: 25, unit: "%", showIf: (v) => v.task === "outpaint" },
    { key: "outTop", label: "Haut", type: "slider", min: 0, max: 100, step: 5, default: 0, unit: "%", showIf: (v) => v.task === "outpaint" },
    { key: "outBottom", label: "Bas", type: "slider", min: 0, max: 100, step: 5, default: 0, unit: "%", showIf: (v) => v.task === "outpaint" },
    { key: "prompt", label: "Prompt", type: "textarea", rows: 4, default: "", placeholder: 'A vertical poster divided into four panels, titled "THE SEARCH"…' },
    { key: "mode", label: "Mode", type: "select", options: Q_MODES, default: Q_MODES[0],
      labels: { [Q_MODES[0]]: "Turbo HQ · Viggle · 6 étapes", [Q_MODES[1]]: "Turbo · Pruna · 8 étapes", [Q_MODES[2]]: "Turbo Fast · Alibaba · 4 étapes", [Q_MODES[3]]: "Qualité · base + CFG (lent)" },
      hint: "Les turbos ignorent CFG et prompt négatif. Qualité ≈ 7-10× plus lent." },
    { key: "transparent", label: "Fond transparent (PNG RGBA)", type: "checkbox", default: false },
    { key: "style", label: "Style", type: "select", options: ["None", "Cinematic", "Photographic", "Anime", "Cyberpunk", "Fantasy"], default: "None", labels: { None: "Aucun" } },
    { key: "resolution", label: "Résolution", type: "select", options: ["768px (fastest)", "1024px (recommended)", "1536px (high, slow on T4)"], default: "1024px (recommended)",
      labels: { "768px (fastest)": "768 px · rapide", "1024px (recommended)": "1024 px · recommandé", "1536px (high, slow on T4)": "1536 px · lent sur T4" } },
    { key: "aspect", label: "Ratio", type: "select", options: ["Match input image", "1:1 Square", "16:9 Landscape", "9:16 Portrait", "4:3 Standard", "3:4 Portrait", "2:3 Poster"], default: "1:1 Square",
      labels: { "Match input image": "Comme l'image d'entrée" }, showIf: (v) => v.task === "create" || v.task === "refs" },
    { key: "numImages", label: "Nombre d'images", type: "slider", min: 1, max: 4, step: 1, default: 1, hint: "Générées l'une après l'autre, seed +1." },
    { key: "negative", label: "Prompt négatif", type: "textarea", rows: 2, default: "", advanced: true, placeholder: "low quality, blurry, distorted, bad anatomy, watermark", showIf: (v) => v.mode === Q_QUALITY },
    { key: "steps", label: "Étapes (Qualité)", type: "slider", min: 10, max: 50, step: 1, default: 40, advanced: true, showIf: (v) => v.mode === Q_QUALITY },
    { key: "guidance", label: "Guidance / CFG (Qualité)", type: "slider", min: 1, max: 8, step: 0.5, default: 4, advanced: true, showIf: (v) => v.mode === Q_QUALITY },
    { key: "seed", label: "Seed", type: "seed", default: -1 },
  ],
  async build(v, file) {
    const task = s(v.task) as keyof typeof Q_TASK;
    let refs: { image: File; caption: null }[] | null = null;
    let editor: unknown = null;
    let outImg: File | null = null;
    if (task === "refs") {
      const files = (await Promise.all(((v.refs as string[]) ?? []).slice(0, 10).map(file))).filter(Boolean) as File[];
      if (!files.length) throw new Error("Ajoute au moins une image.");
      refs = files.map((image) => ({ image, caption: null }));
    }
    if (task === "inpaint") {
      const m = v.mask as MaskValue;
      const bg = m && (await file(m.sourceId));
      if (!m || !bg) throw new Error("Choisis une image puis peins la zone à changer.");
      editor = { background: bg, layers: [new File([m.mask], "mask.png", { type: "image/png" })], composite: null };
    }
    if (task === "outpaint") {
      outImg = await file(v.outpaintImage as string);
      if (!outImg) throw new Error("Choisis l'image à étendre.");
    }
    const prompt = s(v.prompt);
    if (!prompt.trim() && task !== "outpaint") throw new Error("Écris un prompt.");
    return {
      endpoint: "/generate_image", style: "queue", output: "image", label: `Qwen-Image · ${({ create: "création", refs: "édition", inpaint: "inpaint", outpaint: "outpaint" })[task]}`,
      data: [Q_TASK[task], prompt, refs, editor, n(v.strength, 1), outImg, s(v.outpaintRatio), n(v.outTop), n(v.outBottom), n(v.outLeft, 25), n(v.outRight, 25),
        s(v.negative), s(v.style), s(v.mode), Boolean(v.transparent), n(v.steps, 40), n(v.guidance, 4), task === "create" || task === "refs" ? s(v.aspect) : "Match input image",
        s(v.resolution), n(v.seed, -1), n(v.numImages, 1)],
    };
  },
};

// ───────────────────────────── MiniMax H3 Turbo (T4 x2) ─────────────────────────────
const H3_LORAS = [
  "None", "🧑 Realism People (fal)", "🎥 Camera Motion", "🔄 360° Orbit (same image as first + last frame)", "⚔️ Weapon Combat (BUNNY)",
  "🧱 Spatial & Physics", "🗣️ Natural Face & Speech", "🎞️ Studio 1939 Animation", "🌸 Anime Motion", "📼 VHS Tape (1980s)",
];
/** Default strength per LoRA, as the notebook sets it when one is picked. */
export const H3_LORA_SCALE: Record<string, number> = {
  "🧑 Realism People (fal)": 1, "🎥 Camera Motion": 0.9, "🔄 360° Orbit (same image as first + last frame)": 1, "⚔️ Weapon Combat (BUNNY)": 1,
  "🧱 Spatial & Physics": 0.4, "🗣️ Natural Face & Speech": 0.7, "🎞️ Studio 1939 Animation": 1, "🌸 Anime Motion": 1, "📼 VHS Tape (1980s)": 1,
};
const H3_LORA_INFO: Record<string, string> = {
  None: "Aucun",
  "🧑 Realism People (fal)": "Realism People · peaux, visages",
  "🎥 Camera Motion": "Camera Motion · décris le mouvement",
  "🔄 360° Orbit (same image as first + last frame)": "Orbite 360° · même image début/fin",
  "⚔️ Weapon Combat (BUNNY)": "Weapon Combat · chorégraphies",
  "🧱 Spatial & Physics": "Spatial & Physics · 0,3-0,5",
  "🗣️ Natural Face & Speech": "Natural Face & Speech · talking heads",
  "🎞️ Studio 1939 Animation": "Studio 1939 · animation peinte",
  "🌸 Anime Motion": "Anime Motion · avec image de départ",
  "📼 VHS Tape (1980s)": "VHS 1980s · usure image et son",
};
const H3_LANGS = ["English", "Chinese", "Spanish", "French", "German", "Japanese", "Korean", "Hindi", "Urdu", "Arabic", "Portuguese", "Russian", "Italian", "Turkish", "Indonesian"];

const minimax: ModelSpec = {
  id: "minimax",
  name: "MiniMax H3 Turbo",
  short: "MiniMax H3",
  vendor: "MiniMax · INT8",
  kind: "video",
  hardware: "Kaggle · T4 x2",
  notebookUrl: "https://www.kaggle.com/code/unlockbulk/minimax-h3-turbo-int8-video-audio",
  endpoints: ["/start_generation", "/poll_job"],
  progressRoute: true,
  blurb: "Vidéo + audio stéréo 32 kHz synchronisés, depuis texte, images début/fin ou références.",
  speedHint: "480p · 5 s = le bon compromis · 720p 15 s ≈ 45 min",
  fields: [
    { key: "prompt", label: "Scène / action", type: "textarea", rows: 4, default: "", placeholder: "A cinematic shot of… sujet, action, caméra, lumière" },
    { key: "dialogue", label: "Réplique prononcée", type: "text", default: "", placeholder: "Les mots exacts du personnage (lip-sync)" },
    { key: "language", label: "Langue", type: "select", options: H3_LANGS, default: "French" },
    { key: "sound", label: "Bruitages / ambiance", type: "text", default: "" },
    { key: "music", label: "Musique de fond", type: "text", default: "" },
    { key: "resolution", label: "Résolution", type: "select", options: ["360p (fastest)", "480p (recommended)", "540p", "720p (slow)"], default: "480p (recommended)",
      labels: { "360p (fastest)": "360p · aperçu", "480p (recommended)": "480p · recommandé", "540p": "540p", "720p (slow)": "720p · lent" } },
    { key: "aspect", label: "Ratio", type: "select", options: ["Auto (match image)", "16:9 Landscape", "9:16 Portrait", "1:1 Square", "4:3 Classic", "3:4 Portrait", "21:9 Cinema"], default: "Auto (match image)",
      labels: { "Auto (match image)": "Auto (comme l'image)" } },
    { key: "duration", label: "Durée", type: "segmented", options: ["3 s", "4.5 s", "5 s", "6.5 s", "8 s", "10 s", "12 s", "15 s"], default: "5 s" },
    { key: "steps", label: "Qualité / vitesse", type: "select", options: ["⚡ Fast - 4 steps", "⚖️ Balanced - 6 steps", "💎 Quality - 8 steps"], default: "⚡ Fast - 4 steps",
      labels: { "⚡ Fast - 4 steps": "Rapide · 4 étapes", "⚖️ Balanced - 6 steps": "Équilibré · 6 étapes", "💎 Quality - 8 steps": "Qualité · 8 étapes" } },
    { key: "seed", label: "Seed", type: "seed", default: -1 },
    { key: "startImg", label: "Image de départ", type: "asset", kind: "image", default: null, hint: "Seule = anime l'image. Avec une image de fin = interpolation." },
    { key: "endImg", label: "Image de fin", type: "asset", kind: "image", default: null },
    { key: "ref1", label: "Référence 1", type: "asset", kind: "image", default: null, advanced: true, hint: "Références personnages/objets : variantes Ref2VA du notebook seulement." },
    { key: "ref2", label: "Référence 2", type: "asset", kind: "image", default: null, advanced: true },
    { key: "ref3", label: "Référence 3", type: "asset", kind: "image", default: null, advanced: true },
    { key: "refNames", label: "Qui / quoi dans chaque référence", type: "text", default: "", placeholder: "la femme en rouge, le chien robot, le vieux château", advanced: true },
    { key: "voice", label: "Voix de référence (2-15 s)", type: "asset", kind: "audio", default: null, advanced: true, hint: "Clone la voix de la référence 1 pour la réplique." },
    { key: "lora1", label: "LoRA 1", type: "select", options: H3_LORAS, default: "None", labels: H3_LORA_INFO, advanced: true },
    { key: "s1", label: "Force LoRA 1", type: "slider", min: 0, max: 1.5, step: 0.05, default: 1, advanced: true, showIf: (v) => v.lora1 !== "None" },
    { key: "lora2", label: "LoRA 2", type: "select", options: H3_LORAS, default: "None", labels: H3_LORA_INFO, advanced: true },
    { key: "s2", label: "Force LoRA 2", type: "slider", min: 0, max: 1.5, step: 0.05, default: 1, advanced: true, showIf: (v) => v.lora2 !== "None" },
    { key: "customUrl", label: "LoRA perso (URL .safetensors Hugging Face)", type: "text", default: "", advanced: true, placeholder: "https://huggingface.co/user/repo/resolve/main/lora.safetensors" },
    { key: "s3", label: "Force LoRA perso", type: "slider", min: 0, max: 1.5, step: 0.05, default: 1, advanced: true, showIf: (v) => Boolean(s(v.customUrl).trim()) },
    { key: "autoTrigger", label: "Ajouter les mots déclencheurs des LoRAs", type: "checkbox", default: true, advanced: true },
    { key: "sampler", label: "Sampler", type: "select", options: ["euler", "res_multistep"], default: "euler", advanced: true, hint: "res_multistep : audio plus net avec le turbo fusionné (défaut selon variante)." },
    { key: "shift", label: "Flow shift (vidéo)", type: "slider", min: 1, max: 16, step: 0.5, default: 12, advanced: true },
    { key: "customSteps", label: "Étapes perso (0 = préréglage)", type: "slider", min: 0, max: 12, step: 1, default: 0, advanced: true },
  ],
  async build(v, file) {
    const [start, end, r1, r2, r3, voice] = await Promise.all(
      ["startImg", "endImg", "ref1", "ref2", "ref3", "voice"].map((k) => file(v[k] as string)),
    );
    if (!s(v.prompt).trim() && !start) throw new Error("Décris la scène (ou donne au moins une image de départ).");
    return {
      endpoint: "/start_generation", style: "minimax-job", output: "video", label: `MiniMax H3 · ${s(v.duration)} ${s(v.resolution).split(" ")[0]}`,
      data: [s(v.prompt), s(v.dialogue), s(v.language), s(v.sound), s(v.music), start, end, r1, r2, r3, s(v.refNames), voice,
        s(v.resolution), s(v.aspect), s(v.duration), s(v.steps), s(v.sampler), n(v.shift, 12), n(v.seed, -1),
        s(v.lora1), n(v.s1, 1), s(v.lora2), n(v.s2, 1), s(v.customUrl), null, n(v.s3, 1), Boolean(v.autoTrigger), n(v.customSteps)],
    };
  },
};

// ───────────────────────────── Fish Audio Drama 3 int4 (T4 x2) ─────────────────────────────
const drama3: ModelSpec = {
  id: "drama3",
  name: "Fish Audio Drama 3",
  short: "Drama 3",
  vendor: "Fish Audio · int4",
  kind: "audio",
  hardware: "Kaggle · T4 x2",
  notebookUrl: "https://www.kaggle.com/code/emiliomoreau/fish-audio-drama-3-int4-on-t4-x2",
  endpoints: ["/run"],
  blurb: "TTS expressif 35B MoE : didascalies [entre crochets], scènes multi-voix, clonage, 83 langues.",
  speedHint: "≈ 3-4× plus lent que le temps réel",
  fields: [
    { key: "text", label: "Script", type: "textarea", rows: 7, default: "", placeholder: "[barely holding it together, forcing a smile] I'm fine. [shaky breath] Really.",
      hint: "Didascalies entre [crochets], <|speaker:N|> pour plusieurs personnages.",
      tags: ["[whispering]", "[excited]", "[laughs]", "[sighs]", "[shaky breath]", "[angry]", "[sad]", "[slowly]", "<|speaker:0|>", "<|speaker:1|>"] },
    { key: "refAudio", label: "Clip de référence (5-30 s, une voix)", type: "asset", kind: "audio", default: null, hint: "Optionnel : clone cette voix." },
    { key: "refText", label: "Transcription exacte du clip", type: "textarea", rows: 2, default: "", showIf: (v) => Boolean(v.refAudio), hint: "Obligatoire pour cloner." },
    { key: "temperature", label: "Température", type: "slider", min: 0.1, max: 1, step: 0.05, default: 0.7, advanced: true },
    { key: "topP", label: "Top-p", type: "slider", min: 0.1, max: 1, step: 0.05, default: 0.7, advanced: true },
    { key: "maxNew", label: "Frames max par segment (0 = défaut)", type: "slider", min: 0, max: 2048, step: 64, default: 0, advanced: true },
    { key: "seed", label: "Seed", type: "seed", default: -1, advanced: true },
    { key: "singleChunk", label: "Tout le texte en une passe", type: "checkbox", default: false, advanced: true },
  ],
  async build(v, file) {
    if (!s(v.text).trim()) throw new Error("Écris d'abord une réplique.");
    const ref = await file(v.refAudio as string);
    if (ref && !s(v.refText).trim()) throw new Error("Le clonage demande la transcription exacte du clip.");
    return { endpoint: "/run", style: "queue", output: "audio", label: "Drama 3 · voix",
      data: [s(v.text), ref, s(v.refText), n(v.temperature, 0.7), n(v.topP, 0.7), n(v.maxNew), n(v.seed, -1), Boolean(v.singleChunk)] };
  },
};

// ───────────────────────────── OmniVoice (Colab T4) ─────────────────────────────
const OMNI_LANGS = ["Auto", "English (en)", "Chinese (zh)", "Japanese (ja)", "Korean (ko)", "French (fr)", "German (de)", "Spanish (es)", "Portuguese (pt)",
  "Russian (ru)", "Arabic (ar)", "Hindi (hi)", "Italian (it)", "Dutch (nl)", "Turkish (tr)", "Polish (pl)", "Swedish (sv)", "Thai (th)", "Vietnamese (vi)", "Indonesian (id)", "Malay (ms)"];
const OMNI_ATTR: [string, string, string[]][] = [
  ["gender", "Genre", ["male", "female"]],
  ["age", "Âge", ["child", "teenager", "young adult", "middle-aged", "elderly"]],
  ["pitch", "Hauteur", ["very low pitch", "low pitch", "moderate pitch", "high pitch", "very high pitch"]],
  ["style", "Style", ["whisper"]],
  ["accent", "Accent anglais", ["american accent", "british accent", "australian accent", "canadian accent", "indian accent", "chinese accent", "japanese accent", "korean accent", "portuguese accent", "russian accent"]],
  ["dialect", "Dialecte chinois", ["四川话", "陕西话", "广东话", "东北话", "河南话", "云南话", "贵州话", "桂林话", "济南话"]],
];

const omnivoice: ModelSpec = {
  id: "omnivoice",
  name: "OmniVoice",
  short: "OmniVoice",
  vendor: "k2-fsa",
  kind: "audio",
  hardware: "Colab · T4",
  notebookUrl: "https://colab.research.google.com/github/TeamAIQ/Colab-notebooks/blob/main/notebooks/OmniVoice_TTS_By_AIQUEST.ipynb",
  endpoints: ["/clone_fn", "/design_fn"],
  blurb: "TTS zero-shot rapide, 600+ langues : clonage ou voix décrite (genre, âge, hauteur…).",
  speedHint: "Rapide · quelques secondes par phrase",
  fields: [
    { key: "mode", label: "Mode", type: "segmented", options: ["clone", "design"], default: "clone", labels: { clone: "Cloner une voix", design: "Créer une voix" } },
    { key: "text", label: "Texte", type: "textarea", rows: 5, default: "", placeholder: "Texte à dire… [laughter], [sigh] marchent aussi.",
      tags: ["[laughter]", "[sigh]", "[surprise-ah]", "[question-en]", "[dissatisfaction-hnn]"] },
    { key: "refAudio", label: "Audio de référence (3-10 s)", type: "asset", kind: "audio", default: null, showIf: (v) => v.mode === "clone" },
    { key: "refText", label: "Transcription (optionnel)", type: "textarea", rows: 2, default: "", showIf: (v) => v.mode === "clone", hint: "Vide = transcription automatique." },
    { key: "language", label: "Langue", type: "select", options: OMNI_LANGS, default: "Auto" },
    ...OMNI_ATTR.map(([key, label, opts]) => ({ key, label, type: "select" as const, options: ["Auto", ...opts], default: "Auto", showIf: (v: Values) => v.mode === "design" })),
    { key: "numStep", label: "Étapes d'inférence", type: "slider", min: 8, max: 64, step: 1, default: 32, advanced: true },
    { key: "guidance", label: "Guidance", type: "slider", min: 0, max: 10, step: 0.1, default: 3, advanced: true },
    { key: "denoise", label: "Ratio de débruitage", type: "slider", min: 0, max: 1, step: 0.05, default: 0.8, advanced: true },
    { key: "speed", label: "Vitesse", type: "slider", min: 0.5, max: 2, step: 0.05, default: 1, advanced: true, unit: "×" },
    { key: "duration", label: "Durée (0 = auto)", type: "slider", min: 0, max: 30, step: 0.5, default: 0, advanced: true, unit: "s" },
    { key: "preprocess", label: "Prétraiter le prompt", type: "checkbox", default: true, advanced: true },
    { key: "postprocess", label: "Post-traiter la sortie", type: "checkbox", default: true, advanced: true },
  ],
  async build(v, file) {
    if (!s(v.text).trim()) throw new Error("Écris le texte à dire.");
    const common = [n(v.numStep, 32), n(v.guidance, 3), n(v.denoise, 0.8), n(v.speed, 1), n(v.duration), Boolean(v.preprocess), Boolean(v.postprocess)];
    if (v.mode === "design") {
      return { endpoint: "/design_fn", style: "queue", output: "audio", label: "OmniVoice · voix créée",
        data: [s(v.text), s(v.language), ...common, ...OMNI_ATTR.map(([k]) => s(v[k]) || "Auto")] };
    }
    const ref = await file(v.refAudio as string);
    if (!ref) throw new Error("Choisis un audio de référence à cloner.");
    return { endpoint: "/clone_fn", style: "queue", output: "audio", label: "OmniVoice · clone",
      data: [s(v.text), s(v.language), ref, s(v.refText), ...common] };
  },
};

export const MODELS: ModelSpec[] = [flux3, qwen, minimax, drama3, omnivoice];
export const MODEL_BY_ID: Record<string, ModelSpec> = Object.fromEntries(MODELS.map((m) => [m.id, m]));

export function defaults(m: ModelSpec): Values {
  return Object.fromEntries(m.fields.map((f) => [f.key, Array.isArray(f.default) ? [...f.default] : f.default]));
}
