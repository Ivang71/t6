const idleMap = import.meta.glob('../assets/sounds/tank/engine/idle_*.opus', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const runMap = import.meta.glob('../assets/sounds/tank/engine/run_*.opus', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const shotMap = import.meta.glob('../assets/sounds/tank/shot/*.opus', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

let ctx: AudioContext | null = null;
let started = false;

type SfxName = 'engine_idle' | 'engine_drive' | 'shot' | 'shell' | 'reload';
function pickVariant(): { idle?: string; run?: string } {
  const idleEntries = Object.entries(idleMap).map(([k, v]) => ({ idx: parseInt((k.match(/idle_(\d+)\.opus$/) || [,'-1'])[1]!, 10), url: v }));
  const runEntries = Object.entries(runMap).map(([k, v]) => ({ idx: parseInt((k.match(/run_(\d+)\.opus$/) || [,'-1'])[1]!, 10), url: v }));
  const idleByIdx = new Map(idleEntries.filter(e => !Number.isNaN(e.idx)).map(e => [e.idx, e.url]));
  const runByIdx = new Map(runEntries.filter(e => !Number.isNaN(e.idx)).map(e => [e.idx, e.url]));
  const common = [...idleByIdx.keys()].filter(i => runByIdx.has(i));
  if (common.length === 0) return {};
  const pick = common[Math.floor(Math.random() * common.length)];
  return { idle: idleByIdx.get(pick), run: runByIdx.get(pick) };
}

const picked = pickVariant();
const assets: Partial<Record<SfxName, string>> = {
  engine_idle: picked.idle,
  engine_drive: picked.run,
};

const media: Partial<Record<SfxName, HTMLAudioElement>> = {};
const gains: Partial<Record<SfxName, GainNode>> = {};
let master: GainNode;
let lastDriveVol = 0;
let runEnv = 0;
let idleEnv = 0;
const shotUrls: string[] = Object.values(shotMap);

function initGraph() {
  if (ctx) return;
  ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ latencyHint: 'interactive' });
  master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);
  (Object.keys(assets) as SfxName[]).forEach((name)=>{
    const url = assets[name]!;
    const el = new Audio(url);
    el.loop = name === 'engine_idle' || name === 'engine_drive';
    el.preload = 'auto';
    media[name] = el;
    const src = ctx!.createMediaElementSource(el);
    const g = ctx!.createGain();
    g.gain.value = 0;
    src.connect(g).connect(master);
    gains[name] = g;
  });
}

function start() {
  if (started) return;
  initGraph();
  ctx!.resume().then(()=>{
    started = true;
    (['engine_idle','engine_drive'] as SfxName[]).forEach(n=>{ if (media[n]) { media[n]!.currentTime = 0; media[n]!.play().catch(()=>{}); } });
  });
}

function update(_dt: number, speedRatio: number, isAccelerating: boolean) {
  if (!ctx || !started) return;
  const dt = Math.min(0.1, Math.max(0, (_dt || 16) / 1000));
  const s = Math.max(0, Math.min(1, speedRatio || 0));
  const atIdle = s < 0.05 && !isAccelerating;
  let idleVol: number;
  let driveVol: number;
  if (atIdle) {
    idleVol = 0.07;
    driveVol = 0.0;
  } else {
    const t = Math.max(0, Math.min(1, (s - 0.05) / 0.95));
    const smooth = t * t * (3 - 2 * t);
    idleVol = 0.07 * (1 - smooth);
    driveVol = (isAccelerating ? 0.16 : 0.14) * smooth;
  }
  const decreasing = driveVol < lastDriveVol - 1e-4;
  // Envelope smoothing (run: slower release)
  const runTc = decreasing ? 0.9 : 0.18;
  const idleTc = decreasing ? 0.22 : 0.18;
  const runCoef = 1 - Math.exp(-dt / runTc);
  const idleCoef = 1 - Math.exp(-dt / idleTc);
  runEnv += (driveVol - runEnv) * runCoef;
  idleEnv += (idleVol - idleEnv) * idleCoef;
  if (gains.engine_idle) gains.engine_idle.gain.setValueAtTime(idleEnv, ctx.currentTime);
  if (gains.engine_drive) gains.engine_drive.gain.setValueAtTime(runEnv, ctx.currentTime);
  lastDriveVol = runEnv;
}

function playOnce(name: SfxName, vol: number) {
  if (!ctx || !started) return;
  const el = media[name];
  if (!el) return;
  if (el.loop) { el.currentTime = 0; el.play().catch(()=>{}); return; }
  const one = new Audio(el.src);
  one.preload = 'auto';
  const src = ctx!.createMediaElementSource(one);
  const g = ctx!.createGain();
  g.gain.value = vol;
  src.connect(g).connect(master);
  one.currentTime = 0;
  one.play().then(()=>{
    one.onended = ()=>{ g.disconnect(); src.disconnect(); };
  }).catch(()=>{ g.disconnect(); src.disconnect(); });
}

function shoot() {
  if (!ctx || !started) return;
  if (shotUrls.length === 0) { playOnce('shot', 1); return; }
  const url = shotUrls[Math.floor(Math.random() * shotUrls.length)];
  const one = new Audio(url);
  one.preload = 'auto';
  const src = ctx!.createMediaElementSource(one);
  const g = ctx!.createGain();
  g.gain.value = 1;
  src.connect(g).connect(master);
  one.currentTime = 0;
  one.play().then(()=>{ one.onended = ()=>{ g.disconnect(); src.disconnect(); }; }).catch(()=>{ g.disconnect(); src.disconnect(); });
}
function shellEject() { playOnce('shell', 0.7); }
function reloadClunk() { playOnce('reload', 0.9); }
function setShotProfile(_mode: 'inside' | 'outside') {}

(window as any).audioEngine = { start, update, shoot, setShotProfile, shellEject, reloadClunk };


