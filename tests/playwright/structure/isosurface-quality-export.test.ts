import { expect, type Page, test } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { open_structure_export_pane } from '../helpers'

// Inspect the exact mesh at toBlob, not a screenshot of a later restored preview frame.
async function install_probe(page: Page) {
  await page.evaluate(async () => {
    const module_path = `/src/lib/io/export.ts`
    const { renderer_registry, scene_registry } = await import(/* @vite-ignore */ module_path)
    const canvas = document.querySelector<HTMLCanvasElement>(`#test-structure canvas`)
    if (!canvas) throw new Error(`Missing canvas`)
    const renderer = renderer_registry.get(canvas)
    if (!renderer?.backend.isWebGPUBackend) throw new Error(`Test requires real WebGPU`)
    const original = canvas.toBlob.bind(canvas)
    const captures: unknown[] = []
    Reflect.set(globalThis, `png_captures`, captures)
    canvas.toBlob = (...args) => {
      const colors: string[] = []
      scene_registry
        .get(canvas)
        ?.scene.traverse(
          (node: {
            isMesh?: boolean
            geometry?: { type: string }
            material?: { color?: { getHexString: () => string } }
          }) => {
            if (
              node.isMesh &&
              node.geometry?.type === `BufferGeometry` &&
              node.material?.color
            )
              colors.push(node.material.color.getHexString())
          },
        )
      captures.push({ ...Reflect.get(globalThis, `read_isosurface_export`)(), colors })
      original(...args)
    }
  })
}

const grid_state = (page: Page) =>
  page.evaluate(() => Reflect.get(globalThis, `read_isosurface_export`)?.())
const captured = (page: Page) => page.evaluate(() => Reflect.get(globalThis, `png_captures`))

async function hold_source_jobs(page: Page) {
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage
    const queued: (() => void)[] = []
    let hold = true
    Worker.prototype.postMessage = function (message, options) {
      const send = () => post.call(this, message, options as StructuredSerializeOptions)
      if (hold && message.input?.grid_quality === `source`) queued.push(send)
      else send()
    }
    Reflect.set(globalThis, `held_source_jobs`, () => queued.length)
    Reflect.set(globalThis, `release_source_jobs`, () => {
      hold = false
      queued.splice(0).forEach((send) => send())
    })
  })
}

test.beforeEach(async ({ page }) => {
  await hold_source_jobs(page)
  await page.goto(`/test/isosurface-quality-export`, { waitUntil: `domcontentloaded` })
  await expect
    .poll(() => grid_state(page))
    .toMatchObject({
      quality: `preview`,
      grid_info: [{ quality: `preview`, effective_dims: [79, 79, 79] }],
    })
  await install_probe(page)
})

test(`PNG awaits source grids in a worker and restores preview after capture @source`, async ({
  page,
}) => {
  const { pane_div } = await open_structure_export_pane(page)
  const downloaded = page.waitForEvent(`download`)
  await pane_div.getByRole(`button`, { name: `Download PNG`, exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, `held_source_jobs`)()))
    .toBe(1)
  expect(await captured(page)).toEqual([])
  const concurrent = await page.evaluate(async () => {
    const module_path = `/src/lib/io/export.ts`
    const { canvas_to_png_blob } = await import(/* @vite-ignore */ module_path)
    try {
      await canvas_to_png_blob(document.querySelector(`#test-structure canvas`), 72)
      return `unexpected success`
    } catch (error) {
      return (error as Error).message
    }
  })
  expect(concurrent).toContain(`already in progress`)
  await page.evaluate(() => Reflect.get(globalThis, `release_source_jobs`)())
  const download = await downloaded
  const path = await download.path()
  if (!path) throw new Error(`Missing PNG`)
  const png = await readFile(path)
  expect(png.subarray(0, 8).toString(`hex`)).toBe(`89504e470d0a1a0a`)
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([640, 480])
  const image_path = test.info().outputPath(`source-grid.png`)
  await writeFile(image_path, png)
  await test.info().attach(`source-grid.png`, { path: image_path, contentType: `image/png` })
  const pixels = await page.evaluate(
    async (bytes) => {
      const bitmap = await createImageBitmap(
        new Blob([Uint8Array.from(bytes)], { type: `image/png` }),
      )
      const image = document.createElement(`canvas`)
      image.width = bitmap.width
      image.height = bitmap.height
      const context = image.getContext(`2d`)
      if (!context) throw new Error(`Missing PNG decoding context`)
      context.drawImage(bitmap, 0, 0)
      bitmap.close()
      const { data } = context.getImageData(0, 0, image.width, image.height)
      let red = 0
      let blue = 0
      for (let idx = 0; idx < data.length; idx += 4) {
        const [rr, gg, bb] = data.subarray(idx, idx + 3)
        if (rr > gg * 1.3 && rr > bb * 1.5) red++
        if (bb > rr * 1.5 && bb > gg * 1.1) blue++
      }
      return { red, blue }
    },
    [...png],
  )
  expect(pixels.red).toBeGreaterThan(50)
  expect(pixels.blue).toBeGreaterThan(50)
  expect(await captured(page)).toEqual([
    expect.objectContaining({
      quality: `preview`, // the caller's setting was never changed
      grid_info: [
        {
          volume_id: `signed`,
          quality: `source`,
          source_dims: [96, 96, 96],
          effective_dims: [96, 96, 96],
        },
      ],
      colors: expect.arrayContaining([`2563eb`, `ef4444`]),
    }),
  ])
  await expect
    .poll(() => grid_state(page))
    .toMatchObject({ grid_info: [{ quality: `preview` }] })
})

test(`failed source extraction refuses stale PNG and permits retry @source`, async ({
  page,
}) => {
  await page.evaluate(() => Reflect.get(globalThis, `release_source_jobs`)())
  await page.getByRole(`button`, { name: `Refuse geometry` }).click()
  const { pane_div } = await open_structure_export_pane(page)
  await pane_div.getByRole(`button`, { name: `Download PNG`, exact: true }).click()
  await expect(pane_div.getByText(/budget.*bytes|bytes.*budget/)).toBeVisible()
  expect(await captured(page)).toEqual([])
  await page.getByRole(`button`, { name: `Allow geometry` }).click()
  await open_structure_export_pane(page)
  const downloaded = page.waitForEvent(`download`)
  await pane_div.getByRole(`button`, { name: `Download PNG`, exact: true }).click()
  await downloaded
  expect(await captured(page)).toHaveLength(1)
  await expect
    .poll(() => grid_state(page))
    .toMatchObject({ grid_info: [{ quality: `preview` }] })
})

// oxlint-disable-next-line vitest/prefer-each -- Playwright has no test.each.
for (const action of [`Change isovalue`, `Unmount viewer`]) {
  test(`PNG cancels when ${action} occurs during extraction @source`, async ({ page }) => {
    await page.evaluate(async () => {
      const module_path = `/src/lib/io/export.ts`
      const { canvas_to_png_blob } = await import(/* @vite-ignore */ module_path)
      const canvas = document.querySelector(`#test-structure canvas`)
      void canvas_to_png_blob(canvas, 72).then(
        () => Reflect.set(globalThis, `capture_result`, `unexpected success`),
        (error: Error) => Reflect.set(globalThis, `capture_result`, error.message),
      )
    })
    await expect
      .poll(() => page.evaluate(() => Reflect.get(globalThis, `held_source_jobs`)()))
      .toBe(1)
    await page.getByRole(`button`, { name: action }).click()
    if (action === `Change isovalue`)
      await page.evaluate(() => Reflect.get(globalThis, `release_source_jobs`)())
    await expect
      .poll(() => page.evaluate(() => Reflect.get(globalThis, `capture_result`)))
      .toMatch(action === `Change isovalue` ? /settings changed/ : /unmounted/)
    expect(await captured(page)).toEqual([])
  })
}

// oxlint-disable-next-line vitest/prefer-each -- Playwright has no test.each.
for (const action of [`Empty surface`, `Remove volume`]) {
  test(`PNG completes for ${action} @source`, async ({ page }) => {
    await page.evaluate(() => Reflect.get(globalThis, `release_source_jobs`)())
    await page.getByRole(`button`, { name: action }).click()
    const { pane_div } = await open_structure_export_pane(page)
    const downloaded = page.waitForEvent(`download`)
    await pane_div.getByRole(`button`, { name: `Download PNG`, exact: true }).click()
    await downloaded
    expect(await captured(page)).toHaveLength(1)
  })
}
