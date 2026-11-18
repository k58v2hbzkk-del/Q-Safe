// The hero object: the QSafe mark as a lacquered 3D piece. Scroll drives the story:
// the key leaves the ring, 67 hash chains wrap it, a fresh key slides back in.
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

const LIME = 0xc6ff3d
const INK = 0x0d0d0c

function rr(w, h, r, x = 0, y = 0) {
  const s = new THREE.Shape()
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + h - r)
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  s.lineTo(x + r, y + h)
  s.quadraticCurveTo(x, y + h, x, y + h - r)
  s.lineTo(x, y + r)
  s.quadraticCurveTo(x, y, x + r, y)
  return s
}
const extrude = (shape, depth, bevel = 0.05) =>
  new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 8, curveSegments: 64 }).translate(0, 0, -depth / 2)

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.toneMappingExposure = 0.92
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture
  scene.environmentIntensity = 0.55

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100)
  camera.position.set(0, 0, 9)

  const key = new THREE.DirectionalLight(0xfff6e6, 2.2)
  key.position.set(3, 5, 6)
  scene.add(key, new THREE.AmbientLight(0xfff8ee, 0.35))

  const lime = new THREE.MeshPhysicalMaterial({ color: LIME, roughness: 0.3, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.06 })
  const ink = new THREE.MeshPhysicalMaterial({ color: INK, roughness: 0.16, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.04 })

  // ---- the mark (SVG units / 96, origin at the ring centre, y up)
  const piece = new THREE.Group()
  const ringShape = new THREE.Shape().absarc(0, 0, 1, 0, Math.PI * 2, false)
  ringShape.holes.push(new THREE.Path().absarc(0, 0, 0.583, 0, Math.PI * 2, true))
  const ring = new THREE.Mesh(extrude(ringShape, 0.34, 0.06), lime)
  piece.add(ring)

  const keyGroup = new THREE.Group()
  const u = 1 / 96
  const blade = rr(118 * u, 34 * u, 17 * u, 30 * u, -17 * u)
  const t1 = rr(18 * u, 30 * u, 5 * u, 96 * u, -38 * u)
  const t2 = rr(18 * u, 22 * u, 5 * u, 122 * u, -30 * u)
  for (const s of [blade, t1, t2]) keyGroup.add(new THREE.Mesh(extrude(s, 0.2, 0.035), ink))
  const dot = new THREE.Mesh(extrude(new THREE.Shape().absarc(0, 0, 15 * u, 0, Math.PI * 2, false), 0.2, 0.04), lime)
  dot.position.z = 0.04
  keyGroup.add(dot)
  keyGroup.rotation.z = -Math.PI / 4
  keyGroup.position.z = 0.3
  piece.add(keyGroup)
  scene.add(piece)

  // ---- 67 hash chains × 15 steps: a halo of beads around the ring
  const beads = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 10), new THREE.MeshPhysicalMaterial({ color: INK, roughness: 0.3, clearcoat: 1 }), 67 * 15)
  const tip = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 12), lime, 67)
  const halo = new THREE.Group()
  halo.add(beads, tip)
  const m = new THREE.Matrix4()
  const place = (t) => {
    for (let i = 0; i < 67; i++) {
      const a = (i / 67) * Math.PI * 2
      for (let j = 0; j < 15; j++) {
        const grow = THREE.MathUtils.clamp(t * 1.4 - (i / 67) * 0.4, 0, 1)
        const r = 1.32 + j * 0.042 * grow
        const s = j < 15 * grow ? 0.018 + (j / 15) * 0.008 : 0.0001
        m.compose(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, Math.sin(a * 3 + j * 0.4) * 0.05), new THREE.Quaternion(), new THREE.Vector3(s, s, s))
        beads.setMatrixAt(i * 15 + j, m)
      }
      const rr2 = 1.32 + 15 * 0.042 * THREE.MathUtils.clamp(t * 1.4 - (i / 67) * 0.4, 0, 1)
      const st = t > 0.02 ? 0.03 : 0.0001
      m.compose(new THREE.Vector3(Math.cos(a) * rr2, Math.sin(a) * rr2, 0), new THREE.Quaternion(), new THREE.Vector3(st, st, st))
      tip.setMatrixAt(i, m)
    }
    beads.instanceMatrix.needsUpdate = true
    tip.instanceMatrix.needsUpdate = true
  }
  place(0)
  piece.add(halo)

  // ---- soft floor shadow
  const sc = document.createElement('canvas')
  sc.width = sc.height = 128
  const g = sc.getContext('2d')
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grd.addColorStop(0, 'rgba(60,50,30,0.32)')
  grd.addColorStop(1, 'rgba(60,50,30,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 128, 128)
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.9), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }))
  shadow.position.y = -1.75
  scene.add(shadow)

  // ---- timeline
  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
  const seg = (p, a, b) => ease(THREE.MathUtils.clamp((p - a) / (b - a), 0, 1))
  let progress = 0
  let mobile = false
  let pointer = { x: 0, y: 0 }

  function resize() {
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    mobile = w < 760
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.position.z = mobile ? 11.5 : 9
    camera.updateProjectionMatrix()
  }
  addEventListener('resize', resize)
  addEventListener('pointermove', (e) => (pointer = { x: e.clientX / innerWidth - 0.5, y: e.clientY / innerHeight - 0.5 }))
  resize()

  // stops: 0 hero · 1 one lock · 2 key out · 3 hash chains · 4 new key · 5 attack blocked
  const clock = new THREE.Clock()
  function frame() {
    const t = clock.getElapsedTime()
    const p = progress
    const side = mobile ? 0 : 1
    // where the piece sits: right in the hero, swings left/right with the chapters
    const xs = [1.55, 1.7, -1.6, 1.75, 1.7, -1.6, -1.6]
    const i = Math.min(Math.floor(p), 5)
    const f = ease(p - i)
    const x = THREE.MathUtils.lerp(xs[i], xs[i + 1], f) * side
    const y = mobile ? 1.62 : 0.05
    piece.position.set(x, y + Math.sin(t * 0.9) * 0.05, 0)
    shadow.position.set(x, mobile ? 0.6 : -1.75, 0)
    shadow.visible = !mobile
    shadow.material.opacity = 1 - seg(p, 2.4, 3.0) * 0.6 + seg(p, 3.6, 4.2) * 0.6

    const sc2 = (mobile ? 0.7 : 1) * (1 - seg(p, 2.3, 3) * 0.12 + seg(p, 3.6, 4.2) * 0.12)
    piece.scale.setScalar(sc2)
    piece.rotation.y = -0.45 + Math.sin(t * 0.35) * 0.12 + seg(p, 0.6, 1.4) * 0.65 - seg(p, 1.6, 2.4) * 0.5 + seg(p, 3.4, 4.4) * Math.PI * 2 + pointer.x * 0.25
    piece.rotation.x = 0.18 + pointer.y * 0.15 - seg(p, 4.4, 5) * 0.12

    // key: lifts out along its own diagonal (like a lid), hides while the chains form, returns new
    const out = seg(p, 1.2, 2.1) - seg(p, 3.5, 4.3)
    const ko = mobile ? 0.45 : 0.7
    keyGroup.position.set(0.95 * out * ko, -0.35 * out * ko + (mobile ? 0.5 * out : 0), 0.3 + 0.9 * out)
    keyGroup.rotation.set(0.5 * out, -0.7 * out, -Math.PI / 4 + 0.5 * out)
    // attack: a quick refusal shake
    const hit = seg(p, 4.55, 4.75) - seg(p, 4.75, 4.95)
    piece.position.x += Math.sin(t * 40) * 0.03 * hit

    place(seg(p, 2.2, 3.1) - seg(p, 3.9, 4.6))
    halo.rotation.z = t * 0.08

    renderer.render(scene, camera)
    requestAnimationFrame(frame)
  }
  frame()
  return { setProgress: (v) => (progress = v) }
}
