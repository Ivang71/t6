import { engineIdleUrls, engineRunUrls, tankShotUrls } from '../assets/audio';

let ctx: AudioContext | null = null;
let started = false;

type SfxName = 'engine_idle' | 'engine_drive';
function pickVariant(): { idle?: string; run?: string } {
  if (engineIdleUrls.length === 0 || engineRunUrls.length === 0) return {};
  const candidates = engineIdleUrls
    .map(u => ({ idx: parseInt((u.match(/idle_(\d+)\.opus$/) || [,'-1'])[1]!, 10), url: u }))
    .filter(e => !Number.isNaN(e.idx))
    .filter(e => engineRunUrls.some(r => r.includes(`run_${e.idx}.opus`)));
  if (candidates.length === 0) return {};
  const pick = candidates[Math.floor(Math.random() * candidates.length)].idx;
  return {
    idle: `/assets/sounds/tank/engine/idle_${pick}.opus`,
    run: `/assets/sounds/tank/engine/run_${pick}.opus`,
  };
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
const shotUrls: string[] = tankShotUrls;

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

function shoot() {
  if (!ctx || !started) return;
  if (shotUrls.length === 0) return;
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

(window as any).audioEngine = { start, update, shoot };


