/**
 * Chrome instance discovery for direct CDP connections.
 *
 * Two discovery strategies that work for ANY Chromium-based browser
 * (Chrome, Chromium, Brave, Ghost Browser, Arc, Edge, etc.):
 *
 * 1. Glob for DevToolsActivePort files in known parent directories.
 *    Chromium writes this file when debugging is enabled (via
 *    chrome://inspect/#remote-debugging or --remote-debugging-port).
 *    Format: line 1 = port, line 2 = /devtools/browser/{guid}
 *
 * 2. Port scan 9222-9229 via GET /json/version. The response includes
 *    { Browser: "Chrome/136...", webSocketDebuggerUrl: "ws://..." }.
 *    This is browser-agnostic — any Chromium fork responds to it.
 *
 * Profile info is read from the Local State JSON file in each browser's
 * data directory (profile name, email, etc.).
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface ChromeProfile {
  dir: string
  name: string
  email: string
}

export interface DiscoveredInstance {
  browser: string
  port: number
  wsUrl: string
  /** Profiles found in the data directory that contained the DevToolsActivePort file */
  profiles: ChromeProfile[]
  /** The data directory this instance was discovered from (null if from port scan only) */
  dataDir: string | null
}

export interface ParsedActivePort {
  port: number
  wsPath: string
}

/**
 * Parse the contents of a DevToolsActivePort file.
 * Format: line 1 = port number, line 2 = /devtools/browser/{guid}
 */
export function parseDevToolsActivePort(contents: string): ParsedActivePort | null {
  const lines = contents.trim().split('\n')
  if (lines.length < 2) {
    return null
  }
  const port = parseInt(lines[0].trim(), 10)
  if (isNaN(port) || port <= 0 || port > 65535) {
    return null
  }
  const wsPath = lines[1].trim()
  if (!wsPath.startsWith('/devtools/browser/')) {
    return null
  }
  return { port, wsPath }
}

/**
 * Read profiles from a Chrome/Chromium data directory's Local State file.
 * Returns profile directory name, display name, and email.
 */
export function getChromeProfiles(dataDir: string): ChromeProfile[] {
  const localStatePath = path.join(dataDir, 'Local State')
  try {
    const content = fs.readFileSync(localStatePath, 'utf-8')
    const data = JSON.parse(content) as {
      profile?: {
        info_cache?: Record<
          string,
          {
            name?: string
            gaia_name?: string
            user_name?: string
          }
        >
      }
    }
    const infoCache = data?.profile?.info_cache
    if (!infoCache) {
      return []
    }
    return Object.entries(infoCache).map(([dir, info]) => {
      return {
        dir,
        name: info.gaia_name || info.name || dir,
        email: info.user_name || '',
      }
    })
  } catch {
    return []
  }
}

/**
 * Derive a human-readable browser name from a data directory path.
 * e.g. ".../Google/Chrome/DevToolsActivePort" → "Chrome"
 *      ".../BraveSoftware/Brave-Browser/..." → "Brave"
 *      ".../Ghost Browser/..." → "Ghost Browser"
 */
export function deriveBrowserName(dataDir: string): string {
  const normalized = dataDir.replace(/\\/g, '/')
  const lower = normalized.toLowerCase()

  if (lower.includes('chrome canary') || lower.includes('chrome-canary')) {
    return 'Chrome Canary'
  }
  if (lower.includes('chrome for testing')) {
    return 'Chrome for Testing'
  }
  if (lower.includes('google/chrome') || lower.includes('google-chrome') || lower.includes('google\\chrome')) {
    return 'Chrome'
  }
  if (lower.includes('chromium')) {
    return 'Chromium'
  }
  if (lower.includes('brave')) {
    return 'Brave'
  }
  if (lower.includes('ghost browser') || lower.includes('ghost-browser')) {
    return 'Ghost Browser'
  }
  if (lower.includes('microsoft edge') || lower.includes('microsoft\\edge')) {
    return 'Edge'
  }
  if (lower.includes('vivaldi')) {
    return 'Vivaldi'
  }
  if (lower.includes('opera')) {
    return 'Opera'
  }
  if (lower.includes('arc')) {
    return 'Arc'
  }

  // Fallback: use the parent directory name
  const parts = normalized.split('/')
  const lastMeaningful = parts.filter(Boolean).pop() || 'Unknown'
  return lastMeaningful
}

/**
 * Get parent directories to scan for DevToolsActivePort files.
 * These are the top-level directories where Chromium-based browsers
 * store their data. We glob inside them to find any browser.
 */
export function getDataDirParents({
  platform = os.platform(),
  homeDir = os.homedir(),
}: {
  platform?: NodeJS.Platform
  homeDir?: string
} = {}): string[] {
  if (platform === 'darwin') {
    return [path.join(homeDir, 'Library', 'Application Support')]
  }
  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local')
    return [localAppData]
  }
  // Linux
  return [path.join(homeDir, '.config')]
}

/**
 * Scan parent directories for DevToolsActivePort files at depth 1-3.
 * Returns { dataDir, parsed } for each found file.
 */
export function findDevToolsActivePortFiles({
  platform,
  homeDir,
}: {
  platform?: NodeJS.Platform
  homeDir?: string
} = {}): Array<{ dataDir: string; parsed: ParsedActivePort }> {
  const parents = getDataDirParents({ platform, homeDir })
  const results: Array<{ dataDir: string; parsed: ParsedActivePort }> = []
  const seen = new Set<number>()

  for (const parent of parents) {
    if (!fs.existsSync(parent)) {
      continue
    }
    // Scan up to depth 3 for DevToolsActivePort
    // Typical paths:
    //   {parent}/Google/Chrome/DevToolsActivePort          (depth 2)
    //   {parent}/BraveSoftware/Brave-Browser/DevToolsActivePort (depth 2)
    //   {parent}/Chromium/DevToolsActivePort               (depth 1)
    //   {parent}/google-chrome/DevToolsActivePort          (depth 1, Linux)
    scanForActivePort({ dir: parent, depth: 0, maxDepth: 3, results, seen })
  }

  return results
}

function scanForActivePort({
  dir,
  depth,
  maxDepth,
  results,
  seen,
}: {
  dir: string
  depth: number
  maxDepth: number
  results: Array<{ dataDir: string; parsed: ParsedActivePort }>
  seen: Set<number>
}): void {
  if (depth > maxDepth) {
    return
  }

  const activePortPath = path.join(dir, 'DevToolsActivePort')
  try {
    if (fs.existsSync(activePortPath)) {
      const contents = fs.readFileSync(activePortPath, 'utf-8')
      const parsed = parseDevToolsActivePort(contents)
      if (parsed && !seen.has(parsed.port)) {
        seen.add(parsed.port)
        results.push({ dataDir: dir, parsed })
      }
      // Don't recurse deeper once we found a DevToolsActivePort
      return
    }
  } catch {
    // Permission error or similar, skip
  }

  // Only recurse into subdirectories, not into profile dirs (Default, Profile 1, etc.)
  // Profile dirs contain Preferences, not DevToolsActivePort
  if (depth >= maxDepth) {
    return
  }

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }
      // Skip hidden dirs and obvious non-browser dirs
      if (entry.name.startsWith('.') || entry.name === 'node_modules') {
        continue
      }
      scanForActivePort({
        dir: path.join(dir, entry.name),
        depth: depth + 1,
        maxDepth,
        results,
        seen,
      })
    }
  } catch {
    // Permission error, skip
  }
}

interface JsonVersionResponse {
  Browser?: string
  webSocketDebuggerUrl?: string
  'Protocol-Version'?: string
}

/**
 * Probe a port via GET /json/version to check if a Chromium debugger is listening.
 * Returns the webSocketDebuggerUrl and browser name, or null.
 */
export async function probePort(port: number): Promise<{ wsUrl: string; browser: string } | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(1000),
    })
    if (!response.ok) {
      return null
    }
    const data = (await response.json()) as JsonVersionResponse
    if (data.webSocketDebuggerUrl) {
      return {
        wsUrl: data.webSocketDebuggerUrl,
        browser: data.Browser || 'Unknown',
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Discover all Chrome/Chromium instances with debugging enabled.
 *
 * Combines two strategies:
 * 1. Glob for DevToolsActivePort files (finds browsers on any port)
 * 2. Port scan 9222-9229 (finds any Chromium browser on standard debug ports)
 *
 * Deduplicates by port number.
 */
export async function discoverChromeInstances({
  platform,
  homeDir,
}: {
  platform?: NodeJS.Platform
  homeDir?: string
} = {}): Promise<DiscoveredInstance[]> {
  const instances = new Map<number, DiscoveredInstance>()

  // Strategy 1: DevToolsActivePort files
  const activePortFiles = findDevToolsActivePortFiles({ platform, homeDir })
  for (const { dataDir, parsed } of activePortFiles) {
    const browser = deriveBrowserName(dataDir)
    const profiles = getChromeProfiles(dataDir)
    const wsUrl = `ws://127.0.0.1:${parsed.port}${parsed.wsPath}`
    instances.set(parsed.port, { browser, port: parsed.port, wsUrl, profiles, dataDir })
  }

  // Strategy 2: Port scan 9222-9229
  const portProbes = Array.from({ length: 8 }, (_, i) => {
    return i + 9222
  })
  const probeResults = await Promise.all(
    portProbes.map(async (port) => {
      const result = await probePort(port)
      return result ? { port, ...result } : null
    }),
  )

  for (const result of probeResults) {
    if (!result) {
      continue
    }
    if (instances.has(result.port)) {
      // Already found via DevToolsActivePort — prefer the probed wsUrl
      // because DevToolsActivePort can be stale (old GUID) while
      // /json/version always returns the live webSocketDebuggerUrl.
      const existing = instances.get(result.port)!
      existing.wsUrl = result.wsUrl
      if (result.browser !== 'Unknown') {
        existing.browser = parseBrowserVersion(result.browser)
      }
      continue
    }
    instances.set(result.port, {
      browser: parseBrowserVersion(result.browser),
      port: result.port,
      wsUrl: result.wsUrl,
      profiles: [],
      dataDir: null,
    })
  }

  // For port-scan-only instances, try to find their DevToolsActivePort
  // to resolve the data dir and profiles
  for (const [port, instance] of instances) {
    if (instance.dataDir) {
      continue
    }
    // Try to match by checking all known data dirs for a matching port
    for (const { dataDir, parsed } of activePortFiles) {
      if (parsed.port === port) {
        instance.dataDir = dataDir
        instance.profiles = getChromeProfiles(dataDir)
        break
      }
    }
  }

  return Array.from(instances.values()).sort((a, b) => {
    return a.port - b.port
  })
}

/**
 * Parse the Browser string from /json/version into a clean name.
 * e.g. "Chrome/136.0.6781.87" → "Chrome"
 *      "HeadlessChrome/136.0.6781.87" → "Chrome (Headless)"
 */
function parseBrowserVersion(browserString: string): string {
  if (browserString.startsWith('HeadlessChrome/')) {
    return 'Chrome (Headless)'
  }
  if (browserString.startsWith('Chrome/')) {
    return 'Chrome'
  }
  // Strip version suffix for other browsers
  const slashIndex = browserString.indexOf('/')
  if (slashIndex > 0) {
    return browserString.slice(0, slashIndex)
  }
  return browserString
}
