import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const read_source = (relative_path: string): string =>
  readFileSync(resolve(process.cwd(), relative_path), `utf8`)

describe(`declarative structure camera API`, () => {
  const scene = read_source(`src/lib/structure/StructureScene.svelte`)
  const viewport = read_source(`src/lib/structure/StructureViewport.svelte`)
  const scene_camera = read_source(`src/lib/scene/SceneCamera.svelte`)
  const structure = read_source(`src/lib/structure/Structure.svelte`)
  const structure_index = read_source(`src/lib/structure/index.ts`)

  test(`constructs controls in canonical up-space and re-keys on roll changes`, () => {
    expect(scene_camera).toContain(`{up}`)
    expect(scene).toContain(`{#key camera_up_key}`)
    expect(scene).toContain(`up={canonical_camera_up}`)
    expect(scene).not.toContain(`camera.up.set`)
    expect(scene).not.toContain(`previous_camera_up_key`)
    expect(scene).toContain(`onchange_extra: on_camera_change`)
  })

  test(`synchronizes wheel/touch/roll state from OrbitControls change events`, () => {
    expect(scene).toContain(`on_camera_change?: () => void`)
    expect(viewport).toContain(`on_camera_change={sync_camera_state}`)
    expect(viewport).toContain(`const sync_camera_state = (): void =>`)
    expect(viewport).not.toContain(`setInterval(sync`)
    expect(viewport).toContain(
      `if (camera_projection === \`orthographic\` && zoom !== undefined) camera_zoom = zoom`,
    )
    expect(viewport).toContain(`camera_zoom: camera_projection === \`orthographic\` ? zoom`)
    expect(viewport).toContain(`camera_position = [...pos]`)
    expect(viewport).toContain(`camera_target = target ? [...target] : undefined`)
    expect(viewport).not.toContain(`on_camera_sync`)
  })

  test(`clamps declarative zoom, snapshots reset state, and isolates side panes`, () => {
    expect(scene).toContain(`clamp_camera_zoom`)
    expect(scene).toContain(`camera_zoom = canonical_zoom`)
    expect(scene).not.toContain(`stored_initial_zoom`)
    expect(scene).toContain(`initial_computed_zoom =`)
    expect(viewport).toContain(`initial_camera_up = $bindable(undefined)`)
    expect(viewport).toContain(`suppress_camera_change = true`)
    expect(viewport).toContain(`reset_camera_to_snapshot`)
    expect(viewport).toContain(`initial_camera_position`)
    expect(viewport).toContain(`initial_camera_target`)
    expect(viewport).toContain(`const current_camera = camera`)
    expect(structure).toContain(`bind:initial_camera_up`)
    expect(viewport).toContain(`bind:initial_computed_zoom`)
    const extra_viewport = structure.slice(structure.indexOf(`{#snippet extra_viewport`))
    expect(extra_viewport).not.toContain(`camera_up={scene_props.camera_up}`)
    expect(extra_viewport).not.toContain(`camera_zoom={scene_props.camera_zoom}`)
  })

  test(`keeps orthographic zoom out of perspective camera callbacks`, () => {
    expect(viewport).toContain(
      `camera_zoom: camera_projection === \`orthographic\` ? camera_zoom : undefined`,
    )
    expect(viewport).toContain(
      `camera_zoom: camera_projection === \`orthographic\` ? zoom : undefined`,
    )
  })

  test(`keeps camera up and zoom in public source types`, () => {
    expect(structure_index).toContain(`camera_up?: Vec3`)
    expect(structure_index).toContain(`camera_zoom?: number`)
    expect(viewport).toContain(`camera_up?: Vec3`)
    expect(viewport).toContain(`camera_zoom?: number`)
    expect(scene).toContain(`camera_up?: Vec3`)
    expect(scene).toContain(`camera_zoom?: number`)
  })

  test(`keeps periodic structure identity snapshots raw`, () => {
    expect(viewport).toContain(
      `let snapshot_structure = $state.raw<AnyStructure | undefined>(undefined)`,
    )
    expect(viewport).toContain(`snapshot_structure !== current_structure`)
  })
})
