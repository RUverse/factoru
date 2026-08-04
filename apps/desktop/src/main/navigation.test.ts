import { describe, expect, it } from 'vitest'
import { isExternallyOpenable, isSameOrigin } from './navigation'

describe('external link policy', () => {
  it.each(['https://example.com/docs', 'http://127.0.0.1:20000/health'])('opens %j', (url) => {
    expect(isExternallyOpenable(url)).toBe(true)
  })

  it.each([
    ['a local file', 'file:///etc/passwd'],
    ['a network share', 'smb://server/share'],
    ['a custom protocol', 'zoommtg://zoom.us/join?confno=1'],
    ['a script URL', 'javascript:alert(1)'],
    ['inline data', 'data:text/html,<script>alert(1)</script>'],
    ['a mail handler', 'mailto:someone@example.com'],
    ['nonsense', 'not a url'],
    ['nothing', ''],
  ])('refuses to hand %s to the shell', (_name, url) => {
    expect(isExternallyOpenable(url)).toBe(false)
  })
})

describe('development navigation policy', () => {
  const devServer = 'http://localhost:5173'

  it.each([
    'http://localhost:5173',
    'http://localhost:5173/',
    'http://localhost:5173/index.html?x=1#y',
  ])('allows %j', (url) => {
    expect(isSameOrigin(url, devServer)).toBe(true)
  })

  it.each([
    ['a userinfo prefix attack', 'http://localhost:5173@evil.example/payload'],
    ['a hostname that merely starts the same', 'http://localhost:51730/'],
    ['a different port', 'http://localhost:5174/'],
    ['a different scheme', 'https://localhost:5173/'],
    ['a different host', 'http://evil.example/'],
    ['a local file', 'file:///etc/passwd'],
  ])('blocks %s', (_name, url) => {
    expect(isSameOrigin(url, devServer)).toBe(false)
  })

  it('blocks everything when no development server is configured', () => {
    expect(isSameOrigin('http://localhost:5173/', undefined)).toBe(false)
    expect(isSameOrigin('http://localhost:5173/', '')).toBe(false)
  })
})
