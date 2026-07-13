import { OrthographicCamera } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { describe, expect, test } from 'vitest'
import { reset_camera_to_snapshot, type CameraResetSnapshot } from '$lib/structure/camera-state'

describe(`camera reset snapshots`, () => {
  test(`restore the original pose after orbit and a keyed camera recreation`, () => {
    const dom_element = document.createElement(`div`)
    const original: CameraResetSnapshot = {
      position: [10, 4, 8],
      target: [1, 2, 3],
      up: [0, 1, 0],
      zoom: 2,
    }

    // X/Y orbit and Z roll happen before the declarative up change recreates the camera.
    const camera = new OrthographicCamera(-10, 10, 10, -10)
    camera.position.set(19, -7, 14)
    camera.up.set(0.2, 0.9, 0.35).normalize()
    camera.zoom = 5
    const controls = new OrbitControls(camera, dom_element)
    controls.target.set(6, -2, 1)
    controls.update()

    // A keyed subtree gets a fresh controls instance whose native baseline is the live pose.
    const keyed_camera = new OrthographicCamera(-10, 10, 10, -10)
    keyed_camera.position.copy(camera.position)
    keyed_camera.up.copy(camera.up)
    keyed_camera.zoom = camera.zoom
    const keyed_controls = new OrbitControls(keyed_camera, dom_element)
    keyed_controls.target.copy(controls.target)
    keyed_controls.update()

    reset_camera_to_snapshot(keyed_camera, keyed_controls, original)

    expect([...keyed_camera.position.toArray()]).toEqual(original.position)
    expect([...keyed_controls.target.toArray()]).toEqual(original.target)
    expect([...keyed_camera.up.toArray()]).toEqual(original.up)
    expect(keyed_camera.zoom).toBe(original.zoom)

    controls.dispose()
    keyed_controls.dispose()
  })
})
