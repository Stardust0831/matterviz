import { prepare_geometry_grid, extract_volume_range } from '#lib/isosurface/sampling.js'
import { GeometryMemoryBudget, GeometryMemoryError } from '#lib/isosurface/memory.js'
import { compute_isosurface_geometries } from '#lib/isosurface/geometry.js'
import { make_volume } from '#lib/isosurface/types.js'
import type { Vec3, Matrix3x3 } from '#lib/math.js'
import { expect, test } from 'vitest'

const lattice: Matrix3x3 = [
  [4, 0, 0],
  [1, 3, 0],
  [0.4, 0.2, 5],
]
const volume = (dims: Vec3, periodic = false) =>
  make_volume(new Float64Array(dims[0] * dims[1] * dims[2]), dims, {
    id: `density`,
    lattice,
    origin: [1, 2, 3],
    periodic,
  })

test.each<Vec3>([
  [79, 79, 79],
  [80, 80, 80],
  [58, 102, 90],
  [160, 160, 160],
  [2, 501, 501],
])(`source preparation reuses finite samples for %j`, (...dims) => {
  const input = volume(dims)
  const source = prepare_geometry_grid(input, null, undefined, `source`)
  expect(source.grid.values).toBe(input.values)
  expect(source.grid.dims).toEqual(dims)
  expect(source.origin).toEqual(input.origin)
  expect(source.lattice).toEqual(lattice)
  const preview = prepare_geometry_grid(input, null)
  expect(preview.grid.values.length).toBeLessThanOrEqual(500_000)
})

test(`periodic and fractional windows use source density and admit storage before sampling`, () => {
  const input = volume([80, 80, 80], true)
  const range: [[number, number], [number, number], [number, number]] = [
    [-0.1, 1.1],
    [0, 2],
    [0, 1],
  ]
  const prepared = prepare_geometry_grid(
    input,
    range,
    new GeometryMemoryBudget(30_000_000),
    `source`,
  )
  expect(prepared.grid.dims).toEqual([97, 161, 81])
  expect(prepared.grid.values).toEqual(extract_volume_range(input, range, Infinity).values)
  expect(() =>
    prepare_geometry_grid(input, range, new GeometryMemoryBudget(100), `source`),
  ).toThrow(GeometryMemoryError)
  expect(input.values).toHaveLength(80 ** 3)
})

test(`source extraction retains signed narrow features that capped preparation removes`, () => {
  const input = volume([160, 160, 160])
  input.values[(80 * 160 + 80) * 160 + 80] = 1
  input.values[(40 * 160 + 40) * 160 + 40] = -1
  const jobs = [
    {
      token: 1,
      volume: input,
      range: null,
      surfaces: [
        { token: `+`, isovalue: 0.5 },
        { token: `-`, isovalue: -0.5 },
      ],
    },
  ]
  const preview = compute_isosurface_geometries({ volumes: jobs })
  const source = compute_isosurface_geometries({
    volumes: jobs,
    grid_quality: `source`,
    memory_budget_bytes: 100_000_000,
  })
  expect(preview.volumes[0].surfaces.map((surface) => surface.indices.length / 3)).toEqual([
    0, 0,
  ])
  expect(source.volumes[0].surfaces.map((surface) => surface.indices.length / 3)).toEqual([
    8, 8,
  ])
  expect(input.values[(80 * 160 + 80) * 160 + 80]).toBe(1)
})
