import { randomUUID } from 'node:crypto'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

/**
 * Crash-safe write: temp file in the same dir → write → fsync → rename → fsync dir.
 * Missing parent dirs are created 0700; the file ends with exactly `mode` (default 0600).
 */
export async function atomicWrite(
  path: string,
  data: string,
  { mode = 0o600 }: { mode?: number } = {},
): Promise<void> {
  const dir = dirname(path)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const tmp = join(dir, `.${basename(path)}.${randomUUID()}.tmp`)
  try {
    const file = await open(tmp, 'wx', mode)
    try {
      await file.chmod(mode) // open() mode is filtered by umask
      await file.writeFile(data, 'utf8')
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(tmp, path)
  } catch (err) {
    await rm(tmp, { force: true })
    throw err
  }
  const dirHandle = await open(dir, 'r')
  try {
    await dirHandle.sync()
  } finally {
    await dirHandle.close()
  }
}
