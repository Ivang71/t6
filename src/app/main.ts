// Bootstraps PixiJS renderer and wires audio engine
import '../audio'
import { Application, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js'
import { spawnMuzzleEffects } from 'src/app/effects'

const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement
const fpsEl = document.getElementById('fps')!

const TANK_LENGTH = 50
const TANK_WIDTH = 35
const TURRET_LENGTH = TANK_LENGTH * 0.9
const TURRET_WIDTH = 8
const TANK_MAX_SPEED = 3.6
const TANK_ACCELERATION = 0.04
const TANK_FORWARD_DRAG_COAST = 0.99
const TANK_FORWARD_DRAG_ACCEL = 0.98
const TANK_LATERAL_FRICTION_COAST = 0.97
const TANK_LATERAL_FRICTION_ACCEL = 0.82
const TANK_TURN_SPEED_MAX = 0.027
const TANK_TURN_ACCELERATION = 0.0012
const TANK_TURN_DECELERATION = 0.93
const TURRET_SMOOTHING = 0.1
const BULLET_SPEED = 15
const FIRE_RATE = 1000
const TANK_RECOIL = 0.05
const TURRET_RECOIL_MAX = 8
const TURRET_RECOIL_RECOVERY = 0.85
const TRACK_LIFETIME = 10000

type TrackMark = { sprite: Sprite; spawnTime: number }
type Bullet = { x: number; y: number; angle: number; speed: number; sprite: Sprite }

const keys: Record<string, boolean> = {}
const mouse = { x: 0, y: 0 }
const bullets: Bullet[] = []
const trackMarks: TrackMark[] = []
let lastShotTime = 0

const player = {
  x: 400,
  y: 300,
  angle: 0,
  turretAngle: 0,
  vx: 0,
  vy: 0,
  turnSpeed: 0,
  turretRecoil: 0,
}

let app: Application
let world: Container
let bulletsContainer: Container
let tracksContainer: Container
let effectsContainer: Container
let playerContainer: Container
let playerBody: Sprite
let playerTurret: Sprite

let tankBodyTexture: Texture
let turretTexture: Texture
let bulletTexture: Texture
let trackTexture: Texture

const bulletPool: Sprite[] = []
const trackPool: Sprite[] = []

let viewportWidth = 800
let viewportHeight = 600

async function init() {
  app = new Application()
  await app.init({
    view: canvas,
    antialias: true,
    autoDensity: true,
    resolution: Math.max(1, Math.min(window.devicePixelRatio || 1, 2)),
    powerPreference: 'high-performance',
    backgroundAlpha: 0,
  })

  world = new Container()
  app.stage.addChild(world)
  app.stage.eventMode = 'static'
  world.sortableChildren = true

  // Pre-bake textures once
  tankBodyTexture = makeTankBodyTexture()
  turretTexture = makeTurretTexture()
  bulletTexture = makeBulletTexture()
  trackTexture = makeTrackTexture()

  // Tracks and bullets containers; Pixi v8 batches sprites sharing textures automatically
  tracksContainer = new Container()
  bulletsContainer = new Container()
  // Ensure tracks render underneath the tank
  world.addChild(tracksContainer)
  tracksContainer.zIndex = 0

  // Player
  playerContainer = new Container()
  playerContainer.position.set(player.x, player.y)
  playerContainer.pivot.set(0, 0)
  world.addChild(playerContainer)
  playerContainer.zIndex = 1

  playerBody = new Sprite(tankBodyTexture)
  playerBody.anchor.set(0.5)
  playerContainer.addChild(playerBody)

  playerTurret = new Sprite(turretTexture)
  playerTurret.anchor.set(0, 0.5)
  playerContainer.addChild(playerTurret)

  // Bullets above tank
  world.addChild(bulletsContainer)
  bulletsContainer.zIndex = 2

  // Effects overlay above bullets
  effectsContainer = new Container()
  world.addChild(effectsContainer)
  effectsContainer.zIndex = 3

  // Input
  window.addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; (window as any).audioEngine?.start() })
  window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false })
  window.addEventListener('resize', resize)

  canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect()
    const scaleX = app.renderer.width / rect.width
    const scaleY = app.renderer.height / rect.height
    mouse.x = (e.clientX - rect.left) * scaleX
    mouse.y = (e.clientY - rect.top) * scaleY
  })
  canvas.addEventListener('mousedown', e => {
    if (e.button === 0) {
      (window as any).audioEngine?.start()
      handleShoot()
    }
  })

  // Start
  resize()
  startTicker()
}

function startTicker() {
  let fpsAccum = 0
  let fpsFrames = 0
  let fpsLastUpdate = 0
  app.ticker.add(t => {
    const deltaMs = t.deltaMS
    update(deltaMs)
    syncSprites()
    fpsAccum += deltaMs
    fpsFrames += 1
    const now = app.ticker.lastTime
    if (now - fpsLastUpdate > 250) {
      const fps = fpsAccum > 0 ? Math.round((fpsFrames * 1000) / fpsAccum) : 0
      fpsEl.textContent = `${fps} FPS`
      fpsAccum = 0
      fpsFrames = 0
      fpsLastUpdate = now
    }
  })
}

function resize() {
  viewportWidth = Math.floor(window.innerWidth)
  viewportHeight = Math.floor(window.innerHeight)
  app.renderer.resize(viewportWidth, viewportHeight)
  app.stage.hitArea = new Rectangle(0, 0, app.renderer.width, app.renderer.height)
}

function handleShoot() {
  const now = Date.now()
  if (now - lastShotTime > FIRE_RATE) {
    lastShotTime = now
    ;(window as any).audioEngine?.shoot()
    const recoilForceX = Math.cos(player.turretAngle + Math.PI) * TANK_RECOIL
    const recoilForceY = Math.sin(player.turretAngle + Math.PI) * TANK_RECOIL
    const tankForwardX = Math.cos(player.angle)
    const tankForwardY = Math.sin(player.angle)
    const dotProduct = recoilForceX * tankForwardX + recoilForceY * tankForwardY
    const finalRecoilVx = dotProduct * tankForwardX
    const finalRecoilVy = dotProduct * tankForwardY
    player.vx += finalRecoilVx
    player.vy += finalRecoilVy
    player.turretRecoil = TURRET_RECOIL_MAX

    const startX = player.x + Math.cos(player.turretAngle) * (TURRET_LENGTH - player.turretRecoil)
    const startY = player.y + Math.sin(player.turretAngle) * (TURRET_LENGTH - player.turretRecoil)
    const sprite = acquireBulletSprite()
    sprite.position.set(startX, startY)
    sprite.rotation = player.turretAngle
    bulletsContainer.addChild(sprite)
    bullets.push({ x: startX, y: startY, angle: player.turretAngle, speed: BULLET_SPEED, sprite })

    // Fire visual effects at muzzle
    spawnMuzzleEffects({
      app,
      container: effectsContainer,
      position: { x: startX, y: startY },
      angle: player.turretAngle,
      drift: { x: player.vx, y: player.vy },
    })
  }
}

function update(deltaTime: number) {
  let isAccelerating = false
  if (keys['w']) {
    player.vx += Math.cos(player.angle) * TANK_ACCELERATION
    player.vy += Math.sin(player.angle) * TANK_ACCELERATION
    isAccelerating = true
  }
  if (keys['s']) {
    player.vx -= Math.cos(player.angle) * (TANK_ACCELERATION / 2)
    player.vy -= Math.sin(player.angle) * (TANK_ACCELERATION / 2)
    isAccelerating = true
  }

  const currentSpeed = Math.sqrt(player.vx * player.vx + player.vy * player.vy)
  ;(window as any).audioEngine?.update(deltaTime, Math.min(1, currentSpeed / TANK_MAX_SPEED), isAccelerating)

  if (currentSpeed > TANK_MAX_SPEED) {
    const scale = TANK_MAX_SPEED / currentSpeed
    player.vx *= scale
    player.vy *= scale
  }

  const forwardVectorX = Math.cos(player.angle)
  const forwardVectorY = Math.sin(player.angle)
  const rightVectorX = -forwardVectorY
  const rightVectorY = forwardVectorX
  const forwardSpeed = player.vx * forwardVectorX + player.vy * forwardVectorY
  const lateralSpeed = player.vx * rightVectorX + player.vy * rightVectorY
  const forwardDrag = isAccelerating ? TANK_FORWARD_DRAG_ACCEL : TANK_FORWARD_DRAG_COAST
  const lateralFriction = isAccelerating ? TANK_LATERAL_FRICTION_ACCEL : TANK_LATERAL_FRICTION_COAST
  const newForwardSpeed = forwardSpeed * forwardDrag
  const newLateralSpeed = lateralSpeed * lateralFriction
  player.vx = (newForwardSpeed * forwardVectorX) + (newLateralSpeed * rightVectorX)
  player.vy = (newForwardSpeed * forwardVectorY) + (newLateralSpeed * rightVectorY)
  if (Math.abs(player.vx) < 0.01) player.vx = 0
  if (Math.abs(player.vy) < 0.01) player.vy = 0

  let turning = false
  if (keys['a']) {
    player.turnSpeed -= TANK_TURN_ACCELERATION
    if (player.turnSpeed < -TANK_TURN_SPEED_MAX) player.turnSpeed = -TANK_TURN_SPEED_MAX
    turning = true
  }
  if (keys['d']) {
    player.turnSpeed += TANK_TURN_ACCELERATION
    if (player.turnSpeed > TANK_TURN_SPEED_MAX) player.turnSpeed = TANK_TURN_SPEED_MAX
    turning = true
  }
  if (!turning) {
    player.turnSpeed *= TANK_TURN_DECELERATION
    if (Math.abs(player.turnSpeed) < 0.001) player.turnSpeed = 0
  }

  player.angle += player.turnSpeed
  player.x += player.vx
  player.y += player.vy

  const movedDistance = Math.sqrt(player.vx * player.vx + player.vy * player.vy)
  if (movedDistance > 0.5) {
    const trackWidthOffset = TANK_WIDTH * 0.4
    const trackOffsetX = -Math.sin(player.angle) * trackWidthOffset
    const trackOffsetY = Math.cos(player.angle) * trackWidthOffset
    const left = acquireTrackSprite()
    left.position.set(player.x + trackOffsetX, player.y + trackOffsetY)
    left.rotation = player.angle
    left.alpha = 0.4
    tracksContainer.addChild(left)
    trackMarks.push({ sprite: left, spawnTime: Date.now() })
    const right = acquireTrackSprite()
    right.position.set(player.x - trackOffsetX, player.y - trackOffsetY)
    right.rotation = player.angle
    right.alpha = 0.4
    tracksContainer.addChild(right)
    trackMarks.push({ sprite: right, spawnTime: Date.now() })
  }

  const expirationTime = Date.now() - TRACK_LIFETIME
  for (let i = trackMarks.length - 1; i >= 0; i--) {
    const mark = trackMarks[i]
    const age = Date.now() - mark.spawnTime
    const lifeRatio = age / TRACK_LIFETIME
    mark.sprite.alpha = Math.max(0, 0.4 * (1 - lifeRatio))
    if (mark.spawnTime < expirationTime) {
      tracksContainer.removeChild(mark.sprite)
      releaseTrackSprite(mark.sprite)
      trackMarks.splice(i, 1)
    }
  }

  const boundingSize = Math.max(TANK_LENGTH, TANK_WIDTH)
  const maxX = app.renderer.width - boundingSize / 2
  const maxY = app.renderer.height - boundingSize / 2
  player.x = Math.max(boundingSize / 2, Math.min(maxX, player.x))
  player.y = Math.max(boundingSize / 2, Math.min(maxY, player.y))

  const targetAngle = Math.atan2(mouse.y - player.y, mouse.x - player.x)
  let angleDiff = targetAngle - player.turretAngle
  while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI
  while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI
  player.turretAngle += angleDiff * TURRET_SMOOTHING

  if (player.turretRecoil > 0) {
    player.turretRecoil *= TURRET_RECOIL_RECOVERY
    if (player.turretRecoil < 0.1) player.turretRecoil = 0
  }

  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i]
    b.x += Math.cos(b.angle) * b.speed
    b.y += Math.sin(b.angle) * b.speed
    if (b.x < 0 || b.x > app.renderer.width || b.y < 0 || b.y > app.renderer.height) {
      bulletsContainer.removeChild(b.sprite)
      releaseBulletSprite(b.sprite)
      bullets.splice(i, 1)
    } else {
      b.sprite.position.set(b.x, b.y)
    }
  }
}

function syncSprites() {
  playerContainer.position.set(player.x, player.y)
  playerContainer.rotation = player.angle
  // Keep turret world rotation absolute so muzzle points correctly during hull turns
  const turretRelative = player.turretAngle - player.angle
  playerTurret.rotation = turretRelative
  // Recoil along the barrel direction (in parent space)
  playerTurret.position.set(
    -Math.cos(turretRelative) * player.turretRecoil,
    -Math.sin(turretRelative) * player.turretRecoil,
  )
}

function acquireBulletSprite(): Sprite {
  const sprite = bulletPool.pop() ?? new Sprite(bulletTexture)
  sprite.anchor.set(0.5)
  sprite.visible = true
  return sprite
}
function releaseBulletSprite(sprite: Sprite) {
  sprite.visible = false
  bulletPool.push(sprite)
}

function acquireTrackSprite(): Sprite {
  const sprite = trackPool.pop() ?? new Sprite(trackTexture)
  sprite.anchor.set(0.2, 0.5)
  sprite.visible = true
  return sprite
}
function releaseTrackSprite(sprite: Sprite) {
  sprite.visible = false
  trackPool.push(sprite)
}

function makeTankBodyTexture(): Texture {
  const g = new Graphics()
  const tipX = TANK_LENGTH * 0.8
  const backX = -TANK_LENGTH / 2
  g.beginFill(0x738093)
  g.lineStyle(2, 0x000000, 0.5)
  g.moveTo(tipX, 0)
  g.lineTo(TANK_LENGTH / 2, -TANK_WIDTH / 2)
  g.lineTo(backX, -TANK_WIDTH / 2)
  g.lineTo(backX, TANK_WIDTH / 2)
  g.lineTo(TANK_LENGTH / 2, TANK_WIDTH / 2)
  g.closePath()
  g.endFill()
  const texture = app.renderer.generateTexture(g)
  g.destroy()
  return texture
}

function makeTurretTexture(): Texture {
  const g = new Graphics()
  g.beginFill(0x111827)
  g.drawRect(0, -TURRET_WIDTH / 2, TURRET_LENGTH, TURRET_WIDTH)
  g.endFill()
  const texture = app.renderer.generateTexture(g)
  g.destroy()
  return texture
}

function makeBulletTexture(): Texture {
  const radius = 5
  const g = new Graphics()
  g.beginFill(0xfacc15)
  g.drawCircle(0, 0, radius)
  g.endFill()
  const texture = app.renderer.generateTexture(g)
  g.destroy()
  return texture
}

function makeTrackTexture(): Texture {
  const g = new Graphics()
  g.beginFill(0x283241)
  g.moveTo(4, 0)
  g.lineTo(-4, -3)
  g.lineTo(-2, 0)
  g.lineTo(-4, 3)
  g.closePath()
  g.endFill()
  const texture = app.renderer.generateTexture(g)
  g.destroy()
  return texture
}

init()


