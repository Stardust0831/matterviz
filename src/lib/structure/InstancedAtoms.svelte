<script lang="ts">
  // All atoms of one visual class (base or ghosted PBC image) in a single
  // THREE.InstancedMesh: one draw call and zero per-atom Svelte components.
  // Per-atom colors live in the instanceColor buffer, per-atom position/radius
  // in the instanceMatrix buffer. Pointer handlers spread onto the mesh receive
  // threlte intersection events whose `instanceId` indexes into `atoms`.
  //
  // This replaces one <extras.Instance> component (plus one scene-graph Group and
  // one interactivity registration) per atom, which made structure changes on
  // supercells block the main thread for seconds and hover raycasts O(n²).
  import type { Vec3 } from '$lib/math'
  import type { MaterialStyle } from '$lib/settings'
  import { T, useThrelte } from '@threlte/core'
  import { untrack } from 'svelte'
  import {
    BackSide,
    Color,
    InstancedMesh,
    Matrix4,
    MeshLambertMaterial,
    MeshBasicMaterial,
    MeshPhongMaterial,
    MeshStandardMaterial,
    SphereGeometry,
  } from 'three'

  type InstancedAtom = {
    position: Vec3
    radius: number
    color?: string
  }

  let {
    atoms,
    sphere_segments = 20,
    material_style = `glossy`,
    roughness = 0.32,
    metalness = 0,
    shininess = 42,
    specular = 0.28,
    outline_enabled = true,
    outline_color = `#252a30`,
    outline_width = 0.04,
    ghost = false,
    ...pointer_props
  }: {
    atoms: InstancedAtom[]
    sphere_segments?: number
    material_style?: MaterialStyle
    roughness?: number
    metalness?: number
    shininess?: number
    specular?: number
    outline_enabled?: boolean
    outline_color?: string
    outline_width?: number
    // edit-mode PBC image atoms: desaturated + translucent
    ghost?: boolean
    // threlte interactivity handlers (onpointerenter, onclick, ...) forwarded to the mesh
    [key: string]: unknown
  } = $props()

  const { invalidate } = useThrelte()

  // Keep one material per shading model so switching appearance does not rebuild
  // atom geometry or instance buffers. Per-atom colors come from instanceColor.
  // InstancedMesh supplies instanceColor automatically. Do not enable regular
  // vertexColors: sphere geometry has no color attribute, so that path would
  // multiply every instance color by black.
  const matte_material = new MeshLambertMaterial()
  const glossy_material = new MeshPhongMaterial()
  const pbr_material = new MeshStandardMaterial()
  const outline_material = new MeshBasicMaterial({
    side: BackSide,
    transparent: true,
    depthWrite: false,
  })
  let active_material = $derived(
    material_style === `matte`
      ? matte_material
      : material_style === `pbr`
        ? pbr_material
        : glossy_material,
  )
  $effect(() => () => {
    matte_material.dispose()
    glossy_material.dispose()
    pbr_material.dispose()
    outline_material.dispose()
  })

  $effect(() => {
    const opacity = ghost ? 0.5 : 1
    for (const material of [matte_material, glossy_material, pbr_material]) {
      material.transparent = ghost
      material.opacity = opacity
      material.depthWrite = !ghost
      material.needsUpdate = true
    }
    glossy_material.shininess = shininess
    glossy_material.specular.setScalar(specular)
    pbr_material.roughness = roughness
    pbr_material.metalness = metalness
    outline_material.color.set(outline_color)
    outline_material.opacity = ghost ? 0.25 : 0.68
    outline_material.visible = outline_enabled && outline_width > 0
    invalidate()
  })

  let geometry = $state.raw<SphereGeometry | null>(null)
  $effect(() => {
    const geo = new SphereGeometry(0.5, sphere_segments, sphere_segments)
    geometry = geo
    return () => geo.dispose()
  })

  // Recreate the mesh only when capacity must change (instanceMatrix buffer size
  // is fixed at construction); data updates just rewrite the buffers below.
  let mesh = $state.raw<InstancedMesh | null>(null)
  let outline_mesh = $state.raw<InstancedMesh | null>(null)
  $effect(() => {
    const count = atoms.length
    const prev = untrack(() => mesh)
    if (prev && prev.count === count) return
    prev?.dispose()
    if (count === 0) {
      mesh = null
      return
    }
    const next = new InstancedMesh(
      untrack(() => geometry) ?? undefined,
      untrack(() => active_material),
      count,
    )
    next.frustumCulled = false
    // export.ts reads per-instance colors (instead of the material color) when set
    next.userData.per_instance_color = true
    mesh = next
  })
  // Unmount-only cleanup (a cleanup on the effect above would dispose the mesh
  // on every re-run, including runs that keep it; cleanups run untracked)
  $effect(() => () => mesh?.dispose())

  $effect(() => {
    const count = atoms.length
    const prev = untrack(() => outline_mesh)
    if (prev && prev.count === count) return
    prev?.dispose()
    if (count === 0) {
      outline_mesh = null
      return
    }
    const next = new InstancedMesh(
      untrack(() => geometry) ?? undefined,
      outline_material,
      count,
    )
    next.frustumCulled = false
    next.renderOrder = -1
    outline_mesh = next
  })
  $effect(() => () => outline_mesh?.dispose())

  $effect(() => {
    if (mesh && mesh.material !== active_material) {
      mesh.material = active_material
      invalidate()
    }
  })

  $effect(() => {
    if (mesh && geometry && mesh.geometry !== geometry) {
      mesh.geometry = geometry
      invalidate()
    }
    if (outline_mesh && geometry && outline_mesh.geometry !== geometry) {
      outline_mesh.geometry = geometry
      invalidate()
    }
  })

  const scratch_matrix = new Matrix4()
  const scratch_color = new Color()
  const gray = new Color(0x999999)

  $effect(() => {
    const current = mesh
    const outline = outline_mesh
    if (!current) return
    const limit = Math.min(atoms.length, current.count)
    for (let idx = 0; idx < limit; idx++) {
      const { position, radius, color } = atoms[idx]
      scratch_matrix
        .makeScale(radius, radius, radius)
        .setPosition(position[0], position[1], position[2])
      current.setMatrixAt(idx, scratch_matrix)
      if (outline) {
        const outline_radius = radius * (1 + outline_width)
        scratch_matrix
          .makeScale(outline_radius, outline_radius, outline_radius)
          .setPosition(position[0], position[1], position[2])
        outline.setMatrixAt(idx, scratch_matrix)
      }
      scratch_color.set(color ?? gray)
      if (ghost) scratch_color.lerp(gray, 0.4)
      current.setColorAt(idx, scratch_color)
    }
    current.instanceMatrix.needsUpdate = true
    if (outline) {
      outline.instanceMatrix.needsUpdate = true
      outline.computeBoundingSphere()
    }
    if (current.instanceColor) current.instanceColor.needsUpdate = true
    // keep the whole-mesh bounding sphere in sync so raycasts can early-reject
    current.computeBoundingSphere()
    invalidate()
  })
</script>

{#if mesh}
  {#if outline_mesh}
    <T is={outline_mesh} raycast={() => null} />
  {/if}
  <T is={mesh} {...pointer_props} />
{/if}
