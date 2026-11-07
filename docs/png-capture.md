# Structure PNG capture

Structure PNG exports temporarily request source-quality isosurfaces and wait
for that geometry and a frame containing it to be submitted before encoding.
They preserve the caller's quality setting and restore interactive quality after
capture, including when preparation, rendering, or encoding fails. Source
extraction uses the viewer's memory budget. A geometry error refuses the export
even when older surfaces remain visible.

Geometry-setting changes, scene unmounts, and a 60-second preparation timeout
cancel a pending capture. Concurrent captures are refused. Failed preparation,
rendering, and encoding release the capture and restore the drawing buffer so
the viewer remains usable. Empty surfaces and scenes without volumes are valid.

The scene registers its preparation callback alongside the renderer and camera.
The existing post-render task resolves the waiter; there is no polling loop.
Scene-model and video exports keep their existing behavior.
