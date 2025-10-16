import { Application, Color, Container, Graphics, Sprite, Texture } from 'pixi.js'

type Vec2 = { x: number; y: number }

type SpawnParams = {
  app: Application
  container: Container
  position: Vec2
  angle: number
  drift?: Vec2
}

// Cached textures for efficiency
let particleTexture: Texture | null = null
let circleTexture: Texture | null = null
let flameTexture: Texture | null = null
let ringTexture: Texture | null = null

function ensureParticleTexture(app: Application) {
  if (particleTexture) return
  const g = new Graphics()
  g.circle(0, 0, 2).fill(0xffffff)
  particleTexture = app.renderer.generateTexture(g)
  g.destroy()
}

function ensureCircleTexture(app: Application) {
  if (circleTexture) return
  const g = new Graphics()
  g.circle(0, 0, 64).fill(0xffffff)
  circleTexture = app.renderer.generateTexture(g)
  g.destroy()
}

function ensureFlameTexture(app: Application) {
  if (flameTexture) return
  const g = new Graphics()
  // build a lumpy star to mimic flame edge
  const prongs = 14
  const inner = 18
  const outer = 64
  g.setFillStyle({ color: 0xffffff })
  g.moveTo(outer, 0)
  for (let i = 1; i <= prongs * 2; i++) {
    const rad = (i % 2 === 0 ? outer : inner) * (0.85 + Math.random() * 0.3)
    const a = (i / (prongs * 2)) * Math.PI * 2
    g.lineTo(Math.cos(a) * rad, Math.sin(a) * rad)
  }
  g.closePath().fill()
  flameTexture = app.renderer.generateTexture(g)
  g.destroy()
}

function ensureRingTexture(app: Application) {
  if (ringTexture) return
  const g = new Graphics()
  g.setStrokeStyle({ width: 6, color: 0xffffff, alpha: 0.9 })
  g.circle(0, 0, 48).stroke()
  ringTexture = app.renderer.generateTexture(g)
  g.destroy()
}

function rand() { return Math.random() }

// Pools
const flamePool: Sprite[] = []
const smokePool: Sprite[] = []
const ringPool: Sprite[] = []
const lightPool: Sprite[] = []
const sparkPool: Sprite[] = []

function acquire(pool: Sprite[], texture: Texture): Sprite {
  const s = pool.pop() ?? new Sprite(texture)
  s.visible = true
  s.anchor.set(0.5)
  return s
}
function release(pool: Sprite[], s: Sprite) {
  s.visible = false
  s.filters = null
  s.parent?.removeChild(s)
  pool.push(s)
}

export function spawnMuzzleEffects(params: SpawnParams) {
  const { app, container, position, angle, drift } = params
  ensureParticleTexture(app)
  ensureCircleTexture(app)
  ensureFlameTexture(app)
  ensureRingTexture(app)

  const seed = rand()

  // Spawn helpers
  const spawnFlame = (pos: Vec2, rot: number, lifeMs: number, length: number, thickness: number) => {
    const s = acquire(flamePool, flameTexture!)
    s.position.set(pos.x, pos.y)
    s.rotation = rot
    s.scale.set(length, thickness)
    s.blendMode = 'add'
    container.addChild(s)
    const start = app.ticker.lastTime
    const tick = () => {
      const t = Math.min(1, (app.ticker.lastTime - start) / lifeMs)
      s.alpha = 1 - t
      s.scale.set(length * (1 + 0.3 * (1 - t)), thickness * (1 - 0.2 * t))
      if (t >= 1) {
        app.ticker.remove(tick)
        release(flamePool, s)
      }
    }
    app.ticker.add(tick)
  }

  const spawnSmoke = (pos: Vec2, lifeMs: number, delayMs: number, _seedAdd: number, driftMul: number) => {
    const s = acquire(smokePool, circleTexture!)
    s.position.set(pos.x, pos.y)
    s.alpha = 0
    container.addChild(s)
    const start = app.ticker.lastTime + delayMs
    const driftX = (drift?.x ?? 0) * driftMul
    const driftY = (drift?.y ?? 0) * driftMul
    const tick = () => {
      const now = app.ticker.lastTime
      if (now < start) return
      const t = Math.min(1, (now - start) / lifeMs)
      s.scale.set(0.6 + 1.1 * t)
      s.x += driftX * 0.06
      s.y += driftY * 0.06
      s.tint = 0x4b5563 // gray
      s.blendMode = 'normal'
      s.alpha = 0.55 * (1 - t)
      if (t >= 1) {
        app.ticker.remove(tick)
        release(smokePool, s)
      }
    }
    app.ticker.add(tick)
  }

  const spawnRing = (pos: Vec2, lifeMs: number) => {
    const s = acquire(ringPool, ringTexture!)
    s.position.set(pos.x, pos.y)
    s.blendMode = 'add'
    container.addChild(s)
    const start = app.ticker.lastTime
    const tick = () => {
      const t = Math.min(1, (app.ticker.lastTime - start) / lifeMs)
      s.scale.set(1 + 3.2 * t)
      s.alpha = 0.8 * (1 - t)
      if (t >= 1) {
        app.ticker.remove(tick)
        release(ringPool, s)
      }
    }
    app.ticker.add(tick)
  }

  const spawnLight = (pos: Vec2, lifeMs: number, baseScale: number) => {
    const s = acquire(lightPool, circleTexture!)
    s.position.set(pos.x, pos.y)
    s.blendMode = 'add'
    s.scale.set(baseScale)
    container.addChild(s)
    const start = app.ticker.lastTime
    const tick = () => {
      const t = Math.min(1, (app.ticker.lastTime - start) / lifeMs)
      s.alpha = 0.8 * (1 - t)
      s.scale.set(baseScale * (1 + 0.15 * t))
      if (t >= 1) {
        app.ticker.remove(tick)
        release(lightPool, s)
      }
    }
    app.ticker.add(tick)
  }

  // Sparks: minimal grains near the muzzle
  const grainCount = 6 + Math.floor(rand() * 4)
  const grains: { s: Sprite; vx: number; vy: number; life: number; max: number }[] = []
  for (let i = 0; i < grainCount; i++) {
    const s = acquire(sparkPool, particleTexture!)
    s.position.set(position.x, position.y)
    s.blendMode = 'add'
    s.tint = 0xffffff
    container.addChild(s)
    const a = angle + (rand() - 0.5) * 0.2
    const speed = 7 + rand() * 5
    grains.push({ s, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: 160 + rand() * 100, max: 200 })
  }
  const onGrains = () => {
    const dt = app.ticker.deltaMS
    for (let i = grains.length - 1; i >= 0; i--) {
      const g = grains[i]
      g.life -= dt
      g.vy += 0.0006 * dt
      g.s.x += g.vx * (dt / 16.67)
      g.s.y += g.vy * (dt / 16.67)
      const t = 1 - Math.max(0, g.life) / g.max
      const c1 = 0xfffff0, c2 = 0xff8a00
      const lerp = (a: number, b: number, w: number) => a + (b - a) * w
      const mix = (a: number, b: number, w: number) => {
        const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff
        const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff
        const r = Math.round(lerp(ar, br, w))
        const g2 = Math.round(lerp(ag, bg, w))
        const b2 = Math.round(lerp(ab, bb, w))
        return (r << 16) | (g2 << 8) | b2
      }
      g.s.tint = mix(c1, c2, Math.min(1, t * 2))
      g.s.alpha = 1 - t
      if (g.life <= 0) {
        release(sparkPool, g.s)
        grains.splice(i, 1)
      }
    }
    if (grains.length === 0) app.ticker.remove(onGrains)
  }
  app.ticker.add(onGrains)

  // Side jets (dominant) and forward tongue
  const sideBias = 0.15
  const leftRot = angle - (Math.PI / 2 - sideBias)
  const rightRot = angle + (Math.PI / 2 - sideBias)
  spawnFlame(position, leftRot, 110, 1.5, 0.6)
  spawnFlame(position, rightRot, 110, 1.5, 0.6)
  spawnFlame(position, angle, 80, 1.0, 0.45)

  // Shock ring
  spawnRing(position, 90)

  // Delayed smoke (two plumes)
  spawnSmoke(position, 1500, 40, 0.3, 0.4)
  spawnSmoke(position, 1500, 40, 0.7, 0.4)

  // Flash light
  const spawnLightNow = () => spawnLight(position, 100, 0.7)
  spawnLightNow()
}


