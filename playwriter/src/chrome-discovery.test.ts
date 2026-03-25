import { describe, test, expect } from 'vitest'
import {
  parseDevToolsActivePort,
  getChromeProfiles,
  deriveBrowserName,
  getDataDirParents,
} from './chrome-discovery.js'

describe('parseDevToolsActivePort', () => {
  test('parses valid contents', () => {
    const result = parseDevToolsActivePort('9222\n/devtools/browser/abc-123-def\n')
    expect(result).toMatchInlineSnapshot(`
      {
        "port": 9222,
        "wsPath": "/devtools/browser/abc-123-def",
      }
    `)
  })

  test('parses with extra whitespace', () => {
    const result = parseDevToolsActivePort('  9222  \n  /devtools/browser/abc  \n')
    expect(result).toMatchInlineSnapshot(`
      {
        "port": 9222,
        "wsPath": "/devtools/browser/abc",
      }
    `)
  })

  test('returns null for single line', () => {
    expect(parseDevToolsActivePort('9222')).toBeNull()
  })

  test('returns null for empty string', () => {
    expect(parseDevToolsActivePort('')).toBeNull()
  })

  test('returns null for invalid port', () => {
    expect(parseDevToolsActivePort('abc\n/devtools/browser/123')).toBeNull()
  })

  test('returns null for port 0', () => {
    expect(parseDevToolsActivePort('0\n/devtools/browser/123')).toBeNull()
  })

  test('returns null for port > 65535', () => {
    expect(parseDevToolsActivePort('99999\n/devtools/browser/123')).toBeNull()
  })

  test('returns null for invalid ws path', () => {
    expect(parseDevToolsActivePort('9222\n/some/other/path')).toBeNull()
  })
})

describe('deriveBrowserName', () => {
  test('detects Chrome from macOS path', () => {
    expect(deriveBrowserName('/Users/user/Library/Application Support/Google/Chrome')).toBe('Chrome')
  })

  test('detects Chrome Canary', () => {
    expect(deriveBrowserName('/Users/user/Library/Application Support/Google/Chrome Canary')).toBe('Chrome Canary')
  })

  test('detects Chrome for Testing', () => {
    expect(deriveBrowserName('/Users/user/Library/Application Support/Google/Chrome for Testing')).toBe(
      'Chrome for Testing',
    )
  })

  test('detects Chromium', () => {
    expect(deriveBrowserName('/Users/user/Library/Application Support/Chromium')).toBe('Chromium')
  })

  test('detects Brave', () => {
    expect(deriveBrowserName('/Users/user/Library/Application Support/BraveSoftware/Brave-Browser')).toBe('Brave')
  })

  test('detects Ghost Browser', () => {
    expect(deriveBrowserName('/Users/user/Library/Application Support/Ghost Browser')).toBe('Ghost Browser')
  })

  test('detects Edge', () => {
    expect(deriveBrowserName('/Users/user/Library/Application Support/Microsoft Edge')).toBe('Edge')
  })

  test('detects Vivaldi', () => {
    expect(deriveBrowserName('/Users/user/Library/Application Support/Vivaldi')).toBe('Vivaldi')
  })

  test('detects Chrome from Linux path', () => {
    expect(deriveBrowserName('/home/user/.config/google-chrome')).toBe('Chrome')
  })

  test('detects Chromium from Linux path', () => {
    expect(deriveBrowserName('/home/user/.config/chromium')).toBe('Chromium')
  })

  test('detects Chrome from Windows path', () => {
    expect(deriveBrowserName('C:\\Users\\user\\AppData\\Local\\Google\\Chrome\\User Data')).toBe('Chrome')
  })

  test('fallback uses last directory name', () => {
    expect(deriveBrowserName('/some/path/MyBrowser')).toBe('MyBrowser')
  })
})

describe('getDataDirParents', () => {
  test('returns Application Support on macOS', () => {
    const result = getDataDirParents({ platform: 'darwin', homeDir: '/Users/test' })
    expect(result).toMatchInlineSnapshot(`
      [
        "/Users/test/Library/Application Support",
      ]
    `)
  })

  test('returns .config on Linux', () => {
    const result = getDataDirParents({ platform: 'linux', homeDir: '/home/test' })
    expect(result).toMatchInlineSnapshot(`
      [
        "/home/test/.config",
      ]
    `)
  })

  test('returns LocalAppData on Windows', () => {
    const originalEnv = process.env.LOCALAPPDATA
    process.env.LOCALAPPDATA = 'C:\\Users\\test\\AppData\\Local'
    const result = getDataDirParents({ platform: 'win32', homeDir: 'C:\\Users\\test' })
    expect(result).toMatchInlineSnapshot(`
      [
        "C:\\Users\\test\\AppData\\Local",
      ]
    `)
    process.env.LOCALAPPDATA = originalEnv
  })
})

describe('getChromeProfiles', () => {
  test('returns empty array for non-existent directory', () => {
    expect(getChromeProfiles('/nonexistent/path')).toEqual([])
  })
})
