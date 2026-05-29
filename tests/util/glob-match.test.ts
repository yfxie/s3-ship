import { describe, expect, test } from 'bun:test'
import { matchGlob, matchesAnyGlob } from '../../src/util/glob-match.js'

describe('matchGlob', () => {
  test('* matches a single path segment', () => {
    expect(matchGlob('a.html', '*.html')).toBe(true)
    expect(matchGlob('sub/a.html', '*.html')).toBe(false)
  })

  test('** matches across path segments', () => {
    expect(matchGlob('a/b/c.js', '**/*.js')).toBe(true)
    expect(matchGlob('a.js', '**/*.js')).toBe(true)
  })

  test('exact match', () => {
    expect(matchGlob('foo.bar', 'foo.bar')).toBe(true)
    expect(matchGlob('foo.baz', 'foo.bar')).toBe(false)
  })

  test('** at end matches everything below', () => {
    expect(matchGlob('assets/x/y.png', 'assets/**')).toBe(true)
    expect(matchGlob('assets/x.png', 'assets/**')).toBe(true)
    expect(matchGlob('other/x.png', 'assets/**')).toBe(false)
  })

  test('matchesAnyGlob returns true if any pattern matches', () => {
    expect(matchesAnyGlob('a.css', ['*.html', '*.css'])).toBe(true)
    expect(matchesAnyGlob('a.png', ['*.html', '*.css'])).toBe(false)
  })

  test('matchesAnyGlob returns false on empty patterns', () => {
    expect(matchesAnyGlob('a.css', [])).toBe(false)
  })

  test('? matches exactly one character within a path segment', () => {
    expect(matchGlob('a.html', '?.html')).toBe(true)
    expect(matchGlob('ab.html', '?.html')).toBe(false)
    expect(matchGlob('.html', '?.html')).toBe(false)
  })

  test('? does not match path separator', () => {
    expect(matchGlob('a/b', 'a?b')).toBe(false)
  })
})
