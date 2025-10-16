// Bootstraps canvas game loop and wires audio engine
import '../audio'

const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
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
const BULLET_SIZE = 5
const FIRE_RATE = 1000
const TANK_RECOIL = 0.05
const TURRET_RECOIL_MAX = 8
const TURRET_RECOIL_RECOVERY = 0.85
const TRACK_LIFETIME = 10000

type TrackMark = { x: number; y: number; angle: number; spawnTime: number }
type Bullet = { x: number; y: number; angle: number; speed: number; size: number; color: string }

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

function resizeCanvas() {
  canvas.width = Math.min(window.innerWidth * 0.9, 1024)
  canvas.height = window.innerHeight * 0.7
}

window.addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; (window as any).audioEngine?.start(); })
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; })
window.addEventListener('resize', resizeCanvas)

canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect()
  mouse.x = e.clientX - rect.left
  mouse.y = e.clientY - rect.top
})

canvas.addEventListener('mousedown', e => {
  if (e.button === 0) {
    (window as any).audioEngine?.start()
    handleShoot()
  }
})

function handleShoot() {
  const now = Date.now()
  if (now - lastShotTime > FIRE_RATE) {
    lastShotTime = now;
    (window as any).audioEngine?.shoot()
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
    bullets.push({
      x: player.x + Math.cos(player.turretAngle) * (TURRET_LENGTH - player.turretRecoil),
      y: player.y + Math.sin(player.turretAngle) * (TURRET_LENGTH - player.turretRecoil),
      angle: player.turretAngle,
      speed: BULLET_SPEED,
      size: BULLET_SIZE,
      color: 'rgb(250, 204, 21)'
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
    const now = Date.now()
    trackMarks.push({ x: player.x + trackOffsetX, y: player.y + trackOffsetY, angle: player.angle, spawnTime: now })
    trackMarks.push({ x: player.x - trackOffsetX, y: player.y - trackOffsetY, angle: player.angle, spawnTime: now })
  }

  const expirationTime = Date.now() - TRACK_LIFETIME
  for (let i = trackMarks.length - 1; i >= 0; i--) {
    if (trackMarks[i].spawnTime < expirationTime) trackMarks.splice(i, 1)
  }

  const boundingSize = Math.max(TANK_LENGTH, TANK_WIDTH)
  player.x = Math.max(boundingSize / 2, Math.min(canvas.width - boundingSize / 2, player.x))
  player.y = Math.max(boundingSize / 2, Math.min(canvas.height - boundingSize / 2, player.y))

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
    const bullet = bullets[i]
    bullet.x += Math.cos(bullet.angle) * bullet.speed
    bullet.y += Math.sin(bullet.angle) * bullet.speed
    if (bullet.x < 0 || bullet.x > canvas.width || bullet.y < 0 || bullet.y > canvas.height) bullets.splice(i, 1)
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const now = Date.now()
  trackMarks.forEach(mark => {
    const age = now - mark.spawnTime
    const lifeRatio = age / TRACK_LIFETIME
    const opacity = Math.max(0, 1 - lifeRatio)
    ctx.fillStyle = `rgba(40, 50, 65, ${opacity * 0.4})`
    ctx.save()
    ctx.translate(mark.x, mark.y)
    ctx.rotate(mark.angle)
    ctx.beginPath()
    ctx.moveTo(4, 0)
    ctx.lineTo(-4, -3)
    ctx.lineTo(-2, 0)
    ctx.lineTo(-4, 3)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  })
  bullets.forEach(bullet => {
    ctx.fillStyle = bullet.color
    ctx.beginPath()
    ctx.arc(bullet.x, bullet.y, bullet.size, 0, Math.PI * 2)
    ctx.fill()
  })
  drawTank(player)
}

function drawTank(tank: typeof player) {
  ctx.save()
  ctx.translate(tank.x, tank.y)
  ctx.rotate(tank.angle)
  const tipX = TANK_LENGTH * 0.8
  const backX = -TANK_LENGTH / 2
  const grad = ctx.createLinearGradient(backX, 0, tipX, 0)
  grad.addColorStop(0, '#2d3748')
  grad.addColorStop(0.8, '#a0aec0')
  grad.addColorStop(1, '#ffffff')
  ctx.fillStyle = grad
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(tipX, 0)
  ctx.lineTo(TANK_LENGTH / 2, -TANK_WIDTH / 2)
  ctx.lineTo(backX, -TANK_WIDTH / 2)
  ctx.lineTo(backX, TANK_WIDTH / 2)
  ctx.lineTo(TANK_LENGTH / 2, TANK_WIDTH / 2)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.rotate(-tank.angle)
  ctx.rotate(tank.turretAngle)
  const muzzleGrad = ctx.createLinearGradient(0, 0, TURRET_LENGTH, 0)
  muzzleGrad.addColorStop(0, '#111827')
  muzzleGrad.addColorStop(0.9, '#111827')
  muzzleGrad.addColorStop(1, '#000000')
  ctx.fillStyle = muzzleGrad
  ctx.fillRect(0 - tank.turretRecoil, -TURRET_WIDTH / 2, TURRET_LENGTH, TURRET_WIDTH)
  ctx.restore()
}

let lastTime = 0
let fpsAccum = 0
let fpsFrames = 0
let fpsLastUpdate = 0
function gameLoop(timestamp: number) {
  const deltaTime = timestamp - lastTime
  lastTime = timestamp
  update(deltaTime)
  draw()
  fpsAccum += deltaTime
  fpsFrames += 1
  if (timestamp - fpsLastUpdate > 250) {
    const fps = fpsAccum > 0 ? Math.round((fpsFrames * 1000) / fpsAccum) : 0
    fpsEl.textContent = `${fps} FPS`
    fpsAccum = 0
    fpsFrames = 0
    fpsLastUpdate = timestamp
  }
  requestAnimationFrame(gameLoop)
}

resizeCanvas()
requestAnimationFrame(gameLoop)


