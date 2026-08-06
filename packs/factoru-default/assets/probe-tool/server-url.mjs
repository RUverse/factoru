import fs from 'node:fs'
import path from 'node:path'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

function normalizeLoopbackUrl(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error(`Invalid Factoru Server URL: ${rawUrl}`)
  }
  if (
    url.protocol !== 'http:' ||
    !LOOPBACK_HOSTS.has(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Factoru tools require a bare HTTP loopback server URL')
  }
  return url.origin
}

function projectedServerUrl(cityPath) {
  if (!path.isAbsolute(cityPath)) throw new Error('GC_CITY must be an absolute path')
  const projection = path.join(cityPath, '.gc', 'factoru-server.json')
  let stat
  try {
    stat = fs.lstatSync(projection)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error('Factoru Server projection must be a private regular file')
  }
  const value = JSON.parse(fs.readFileSync(projection, 'utf8'))
  if (
    !value ||
    value.version !== 1 ||
    typeof value.serverUrl !== 'string' ||
    Object.keys(value).some((key) => key !== 'version' && key !== 'serverUrl')
  ) {
    throw new Error('Factoru Server projection has an unsupported schema')
  }
  return normalizeLoopbackUrl(value.serverUrl)
}

function developmentServerUrl(workdir) {
  const developmentRoot = path.join(workdir, '.factoru-dev')
  const allocations = fs
    .readdirSync(developmentRoot)
    .map((name) => path.join(developmentRoot, name, 'dev-ports.json'))
    .filter((file) => fs.existsSync(file))
  if (allocations.length !== 1) return null
  const port = JSON.parse(fs.readFileSync(allocations[0], 'utf8')).portBase
  return Number.isInteger(port) && port > 0 && port <= 65535 ? `http://127.0.0.1:${port}` : null
}

export function discoverFactoruServerUrl({ env = process.env, workdir = process.cwd() } = {}) {
  if (env.FACTORU_SERVER_URL) return normalizeLoopbackUrl(env.FACTORU_SERVER_URL)
  if (env.GC_CITY) {
    const projected = projectedServerUrl(env.GC_CITY)
    if (projected) return projected
  }
  try {
    const development = developmentServerUrl(path.resolve(workdir))
    if (development) return development
  } catch {
    // The repository-local fallback supports legacy development setups. An
    // invalid allocation is never guessed or broadened into a port scan.
  }
  return 'http://127.0.0.1:8787'
}
