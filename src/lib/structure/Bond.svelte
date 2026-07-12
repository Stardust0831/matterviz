<script lang="ts">
  import type { BondGroupWithGradients } from '$lib/structure'
  import { T } from '@threlte/core'
  import type { InstancedMesh } from 'three'
  import {
    BackSide,
    Color,
    InstancedBufferAttribute,
    Matrix4,
    ShaderMaterial,
    Vector3,
  } from 'three'

  let {
    group,
    saturation = 1,
    brightness = 1,
    shininess = 28,
    outline_enabled = true,
    outline_color = `#252a30`,
    outline_width = 0.04,
  }: {
    group: BondGroupWithGradients
    saturation?: number
    brightness?: number
    shininess?: number
    outline_enabled?: boolean
    outline_color?: string
    outline_width?: number
  } = $props()

  let mesh: InstancedMesh | undefined = $state()
  let outline_mesh: InstancedMesh | undefined = $state()
  // Reusable buffers to avoid reallocation on every update
  let colors_start = new Float32Array(0)
  let colors_end = new Float32Array(0)

  const vertex_shader = `
    attribute vec3 instanceColorStart;
    attribute vec3 instanceColorEnd;
    varying vec3 vColorStart;
    varying vec3 vColorEnd;
    varying float vYPosition;
    varying vec3 vNormal;
    varying vec3 vViewPosition;

    void main() {
      vColorStart = instanceColorStart;
      vColorEnd = instanceColorEnd;
      vYPosition = position.y;
      vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
      vec4 view_position = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      vViewPosition = view_position.xyz;
      gl_Position = projectionMatrix * view_position;
    }
  `

  const fragment_shader = `
    uniform float ambientIntensity;
    uniform float directionalIntensity;
    uniform float fillIntensity;
    uniform float rimIntensity;
    uniform float saturation;
    uniform float brightness;
    uniform float shininess;
    uniform vec3 keyDirection;
    varying vec3 vColorStart;
    varying vec3 vColorEnd;
    varying float vYPosition;
    varying vec3 vNormal;
    varying vec3 vViewPosition;

    vec3 linearTosRGB(vec3 linear) {
      return vec3(
        linear.r <= 0.0031308 ? linear.r * 12.92 : 1.055 * pow(linear.r, 1.0/2.4) - 0.055,
        linear.g <= 0.0031308 ? linear.g * 12.92 : 1.055 * pow(linear.g, 1.0/2.4) - 0.055,
        linear.b <= 0.0031308 ? linear.b * 12.92 : 1.055 * pow(linear.b, 1.0/2.4) - 0.055
      );
    }

    void main() {
      vec3 base_color = mix(vColorStart, vColorEnd, vYPosition + 0.5);

      // Optional artistic adjustment; defaults preserve the exact endpoint colors.
      float gray = dot(base_color, vec3(0.299, 0.587, 0.114));
      base_color = mix(vec3(gray), base_color, saturation) * brightness;

      // Match the atom renderer's camera-relative key/fill/rim light rig.
      vec3 normal = normalize(vNormal);
      vec3 view_dir = normalize(-vViewPosition);
      vec3 fill_dir = normalize(vec3(-0.8, 0.2, 0.7));
      vec3 rim_dir = normalize(vec3(0.15, 0.55, -1.0));
      float key_diffuse = max(dot(normal, keyDirection), 0.0);
      float fill_diffuse = max(dot(normal, fill_dir), 0.0);
      float rim_diffuse = max(dot(normal, rim_dir), 0.0);
      float diffuse_light = directionalIntensity * key_diffuse +
        fillIntensity * fill_diffuse + rimIntensity * rim_diffuse;

      vec3 key_half = normalize(keyDirection + view_dir);
      vec3 fill_half = normalize(fill_dir + view_dir);
      float highlight = directionalIntensity *
        pow(max(dot(normal, key_half), 0.0), shininess);
      highlight += fillIntensity * 0.5 *
        pow(max(dot(normal, fill_half), 0.0), shininess);

      vec3 final_color = base_color * (ambientIntensity + diffuse_light);
      final_color += vec3(0.28) * highlight;

      gl_FragColor = vec4(linearTosRGB(final_color), 1.0);
    }
  `

  function set_color_buffer(
    buffer: Float32Array,
    idx: number,
    color: string,
    temp_color: Color,
  ) {
    // Color.set() already converts CSS sRGB colors to Three.js linear space.
    // Converting again crushed mid-tones and made bonds look almost black.
    temp_color.set(color)
    buffer[idx * 3] = temp_color.r
    buffer[idx * 3 + 1] = temp_color.g
    buffer[idx * 3 + 2] = temp_color.b
  }

  $effect(() => {
    if (!mesh) return

    const count = group.instances.length
    const matrix = new Matrix4()
    const temp_color = new Color()

    // Reallocate buffers if instance count changed
    if (colors_start.length !== count * 3) {
      colors_start = new Float32Array(count * 3)
      colors_end = new Float32Array(count * 3)
    }

    // Update instance matrices and colors
    for (let idx = 0; idx < count; idx++) {
      const instance = group.instances[idx]
      matrix.fromArray(instance.matrix)
      mesh.setMatrixAt(idx, matrix)
      outline_mesh?.setMatrixAt(idx, matrix)
      set_color_buffer(colors_start, idx, instance.color_start, temp_color)
      set_color_buffer(colors_end, idx, instance.color_end, temp_color)
    }

    mesh.instanceMatrix.needsUpdate = true
    if (outline_mesh) {
      outline_mesh.instanceMatrix.needsUpdate = true
      outline_mesh.count = count
    }

    // Update geometry color attributes
    const { geometry } = mesh
    for (const [name, buffer] of [
      [`instanceColorStart`, colors_start],
      [`instanceColorEnd`, colors_end],
    ] as const) {
      const existing = geometry.getAttribute(name)
      if (existing?.array === buffer) existing.needsUpdate = true
      else geometry.setAttribute(name, new InstancedBufferAttribute(buffer, 3))
    }

    mesh.count = count
  })

  // Create the GPU material once + mutate uniforms reactively (a $derived would leak a new
  // ShaderMaterial per lighting tweak). The $effect sets real uniform values before paint.
  const shader_material = new ShaderMaterial({
    vertexShader: vertex_shader,
    fragmentShader: fragment_shader,
    uniforms: {
      ambientIntensity: { value: 0.7 },
      directionalIntensity: { value: 0.3 },
      fillIntensity: { value: 0 },
      rimIntensity: { value: 0 },
      saturation: { value: 0.5 },
      brightness: { value: 0.7 },
      shininess: { value: 28 },
      keyDirection: { value: new Vector3(-0.35, 0.45, 1).normalize() },
    },
  })

  $effect(() => {
    shader_material.uniforms.ambientIntensity.value = group.ambient_light ?? 0.7
    shader_material.uniforms.directionalIntensity.value = group.directional_light ?? 0.3
    shader_material.uniforms.fillIntensity.value = group.fill_light ?? 0
    shader_material.uniforms.rimIntensity.value = group.rim_light ?? 0
    shader_material.uniforms.saturation.value = saturation
    shader_material.uniforms.brightness.value = brightness
    shader_material.uniforms.shininess.value = shininess
    const azimuth = ((group.light_azimuth ?? -28) * Math.PI) / 180
    const elevation = ((group.light_elevation ?? 42) * Math.PI) / 180
    shader_material.uniforms.keyDirection.value.set(
      Math.sin(azimuth) * Math.cos(elevation),
      Math.sin(elevation),
      Math.cos(azimuth) * Math.cos(elevation),
    )
  })

  $effect(() => () => shader_material.dispose())
</script>

{#if outline_enabled && outline_width > 0}
  <T.InstancedMesh args={[undefined, undefined, group.instances.length]} bind:ref={outline_mesh}>
    <T.CylinderGeometry
      args={[
        group.thickness * (1 + outline_width),
        group.thickness * (1 + outline_width),
        1,
        16,
      ]}
    />
    <T.MeshBasicMaterial
      color={outline_color}
      side={BackSide}
      transparent
      opacity={0.68}
      depthWrite={false}
    />
  </T.InstancedMesh>
{/if}
<T.InstancedMesh args={[undefined, shader_material, group.instances.length]} bind:ref={mesh}>
  <T.CylinderGeometry args={[group.thickness, group.thickness, 1, 16]} />
</T.InstancedMesh>
