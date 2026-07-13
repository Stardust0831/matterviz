// Shared single-species Site construction used by all structure/trajectory/volumetric parsers
import type { Vec3 } from '$lib/math'
import type { Site, StructureElement } from '$lib/structure'

export const make_site = (
  element: StructureElement,
  abc: Vec3,
  xyz: Vec3,
  label: string,
  properties: Record<string, unknown> = {},
  occu = 1,
): Site => ({ species: [{ element, occu, oxidation_state: 0 }], abc, xyz, label, properties })
