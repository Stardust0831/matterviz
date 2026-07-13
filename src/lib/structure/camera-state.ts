import type { Vec3 } from '$lib/math'
import type { Camera } from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

/** Stable camera pose used by StructureViewport's reset path. */
export type CameraResetSnapshot = {
  position: Vec3
  target?: Vec3
  up: Vec3
  zoom?: number
}

/**
 * Restore a camera and OrbitControls instance from a baseline that was captured outside
 * the keyed camera subtree. OrbitControls' native reset state is rewritten first because a
 * keyed recreation otherwise saves the current (possibly orbited/rolled) pose as position0.
 */
export function reset_camera_to_snapshot(
  camera: Camera,
  controls: OrbitControls,
  snapshot: CameraResetSnapshot,
): void {
  controls.position0.set(...snapshot.position)
  if (snapshot.target) controls.target0.set(...snapshot.target)
  if (snapshot.zoom !== undefined) controls.zoom0 = snapshot.zoom

  camera.position.set(...snapshot.position)
  camera.up.set(...snapshot.up)
  camera.updateMatrixWorld()
  if (`zoom` in camera && snapshot.zoom !== undefined) {
    camera.zoom = snapshot.zoom
    camera.updateProjectionMatrix()
  }
  if (snapshot.target) controls.target.set(...snapshot.target)
  controls.reset()

  // OrbitControls.reset() does not restore camera.up. Re-apply it after reset and update
  // once more so the controls' spherical state matches the restored pose.
  camera.up.set(...snapshot.up)
  if (snapshot.target) controls.target.set(...snapshot.target)
  controls.update()
}
