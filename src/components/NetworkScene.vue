<script setup lang="ts">
import * as THREE from 'three'
import type { CapriDevice } from '../types/dashboard'

const props = defineProps<{ devices: CapriDevice[] }>()
const canvas = ref<HTMLCanvasElement | null>(null)
const stage = ref<HTMLElement | null>(null)

let renderer: THREE.WebGLRenderer | undefined
let scene: THREE.Scene | undefined
let camera: THREE.PerspectiveCamera | undefined
let frame = 0
let resizeObserver: ResizeObserver | undefined
let cleanupPointer: (() => void) | undefined

const palette = {
  red: 0xff3355,
  cyan: 0x7ce6ef,
  green: 0x55e69a,
  yellow: 0xffd166,
  muted: 0x313642,
}

function buildScene() {
  if (!canvas.value || !stage.value) return
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100)
  camera.position.set(0, 0.6, 8.2)

  renderer = new THREE.WebGLRenderer({ canvas: canvas.value, alpha: true, antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0x000000, 0)

  const group = new THREE.Group()
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.58, 1),
    new THREE.MeshBasicMaterial({ color: palette.red, wireframe: true, transparent: true, opacity: 0.9 }),
  )
  group.add(core)

  const positions = props.devices.map((device, index) => {
    const angle = index * (Math.PI * 2 / Math.max(props.devices.length, 3)) - Math.PI / 2
    return new THREE.Vector3(Math.cos(angle) * 2.8, Math.sin(angle) * 1.15, (index % 2) * -0.4)
  })
  const nodes: THREE.Mesh[] = []
  positions.forEach((position, index) => {
    const device = props.devices[index]
    const color = device.status === 'online' ? palette.green : device.status === 'degraded' ? palette.yellow : palette.red
    const node = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 16, 10),
      new THREE.MeshBasicMaterial({ color }),
    )
    node.position.copy(position)
    group.add(node)
    nodes.push(node)

    const orbit = new THREE.Mesh(
      new THREE.RingGeometry(0.23, 0.25, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.36, side: THREE.DoubleSide }),
    )
    orbit.position.copy(position)
    orbit.rotation.x = Math.PI / 2
    group.add(orbit)
  })

  const lineMaterial = new THREE.LineBasicMaterial({ color: palette.cyan, transparent: true, opacity: 0.28 })
  positions.forEach(position => {
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), position])
    group.add(new THREE.Line(geometry, lineMaterial))
  })
  for (let i = 0; i < 18; i++) {
    const star = new THREE.Mesh(
      new THREE.SphereGeometry(i % 3 === 0 ? 0.018 : 0.01, 6, 4),
      new THREE.MeshBasicMaterial({ color: i % 4 === 0 ? palette.red : palette.muted, transparent: true, opacity: 0.55 }),
    )
    star.position.set((i * 1.37) % 7 - 3.5, ((i * 0.93) % 3) - 1.5, -1.5 - (i % 3))
    group.add(star)
  }
  scene.add(group)

  const onPointer = (event: PointerEvent) => {
    if (!stage.value || !camera) return
    const rect = stage.value.getBoundingClientRect()
    camera.position.x += ((event.clientX - rect.left) / rect.width - 0.5) * 0.012
    camera.position.y += -((event.clientY - rect.top) / rect.height - 0.5) * 0.008
  }
  stage.value.addEventListener('pointermove', onPointer)
  cleanupPointer = () => stage.value?.removeEventListener('pointermove', onPointer)

  const resize = () => {
    if (!stage.value || !renderer || !camera) return
    const { width, height } = stage.value.getBoundingClientRect()
    renderer.setSize(width, height, false)
    camera.aspect = width / Math.max(height, 1)
    camera.updateProjectionMatrix()
  }
  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(stage.value)
  resize()

  const animate = (time: number) => {
    if (!renderer || !scene || !camera) return
    const seconds = time * 0.001
    core.rotation.x = seconds * 0.18
    core.rotation.y = seconds * 0.26
    nodes.forEach((node, index) => {
      const pulse = 1 + Math.sin(seconds * 2.2 + index) * 0.12
      node.scale.setScalar(pulse)
    })
    group.rotation.z = Math.sin(seconds * 0.15) * 0.03
    renderer.render(scene, camera)
    frame = window.requestAnimationFrame(animate)
  }
  frame = window.requestAnimationFrame(animate)
}

onMounted(buildScene)

onBeforeUnmount(() => {
  window.cancelAnimationFrame(frame)
  resizeObserver?.disconnect()
  cleanupPointer?.()
  renderer?.dispose()
  scene?.traverse(object => {
    const mesh = object as THREE.Mesh
    mesh.geometry?.dispose()
    if (Array.isArray(mesh.material)) mesh.material.forEach(material => material.dispose())
    else mesh.material?.dispose()
  })
})
</script>

<template>
  <div ref="stage" class="network-scene" aria-label="Animated network view of connected Capri decks" role="img">
    <canvas ref="canvas" />
    <div class="scene-label scene-label-top">PRIVATE TAILNET <span>LIVE</span></div>
    <div class="scene-label scene-label-bottom"><span class="scene-line" />{{ devices.length }} DECKS / 01 CAPRI NODE</div>
  </div>
</template>

<style scoped>
.network-scene { position: relative; min-height: 310px; overflow: hidden; border: 1px solid var(--capri-line); background: radial-gradient(circle at center, rgb(255 51 85 / 0.08), transparent 42%), #0b0d11; }
.network-scene::before, .network-scene::after { position: absolute; content: ''; pointer-events: none; }
.network-scene::before { inset: 18px; border: 1px solid rgb(124 230 239 / 0.14); clip-path: polygon(0 0, 85% 0, 100% 15%, 100% 100%, 15% 100%, 0 85%); }
.network-scene::after { top: 50%; left: 0; width: 100%; height: 1px; background: linear-gradient(90deg, transparent, rgb(255 51 85 / 0.35), transparent); }
canvas { display: block; width: 100%; height: 100%; min-height: 310px; }
.scene-label { position: absolute; z-index: 1; color: var(--capri-text-dim); font-family: var(--capri-mono); font-size: 9px; letter-spacing: 0.1em; }
.scene-label-top { top: 19px; left: 20px; }
.scene-label-top span { margin-left: 8px; color: var(--capri-green); }
.scene-label-bottom { right: 20px; bottom: 19px; display: flex; align-items: center; gap: 8px; }
.scene-line { display: inline-block; width: 28px; height: 1px; background: var(--capri-red); }
</style>
