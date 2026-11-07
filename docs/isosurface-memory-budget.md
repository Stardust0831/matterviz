# Isosurface resource limits

`IsosurfaceSettings.geometry_memory_budget_bytes` optionally limits the CPU typed
buffers admitted by one `Isosurface` component. For example:

```ts
const settings = {
  ...auto_isosurface_settings(volume),
  geometry_memory_budget_bytes: 256 * 1024 ** 2,
}
```

The component deducts resident prepared grids and meshes before an extraction.
The request accounts for its input working set (including whole backing stores
copied by a Worker), range-preparation buffers, rolling marching-cubes caches,
block masks, growing and trimmed outputs, and all requested signed surfaces.
It also reserves normals, vertex colors and sampled scalar storage for subsequent
coloring. Independent components have independent limits; applications sharing a
process-wide pool must divide it themselves.

Allocations that would exceed the limit are refused before they occur. Errors
use the existing `on_error` callback or the parent Structure's error handler;
previously displayed geometry remains visible. Supplying a larger budget retries
the request. No grid resolution is changed to make an extraction fit.

Omitting the limit preserves existing behavior. Zero refuses nonempty input;
negative, fractional and NaN budgets are invalid. Accounting is conservative and
excludes application-owned source data, JS objects, GC delays and GPU buffers. It
is an admission limit, not an exact bound on browser process or GPU peak memory.

Lower-level callers may share a `GeometryMemoryBudget` across range preparation
and `marching_cubes`. A `GeometryMemoryError` exposes `required_bytes` and
`budget_bytes` for direct calls; worker errors preserve their name and message.

# Sampling resolution

`IsosurfaceSettings.grid_quality` is `preview` by default, retaining the existing
500,000-point cap. Set it to `source` to preserve finite source samples and to
sample periodic/fractional display windows at source voxel density. Arbitrary
fractional bounds still require interpolation; periodic windows include their
endpoints. Source mode can cost substantially more time and memory.

The public controls expose this choice. `Isosurface.grid_info` and
`Structure.analysis.isosurface_grid_info` report source and effective dimensions
for the successfully prepared, currently displayed grids. Those dimensions can
increase when a display range or halo extends a periodic grid. A rejected request
leaves the previous geometry and its diagnostics in place.

Quality and memory admission are separate settings. An insufficient budget
reports an error and never changes source quality to preview. Source grids above
the worker threshold continue to mesh in the worker on isovalue changes, even
when preparation is cached.

Structure PNG export temporarily requests source quality and restores the
interactive quality setting afterward. It uses the same memory budget; failure
does not produce a PNG of older geometry. See [PNG capture](png-capture.md)
for readiness, cancellation, and timeout behavior.
