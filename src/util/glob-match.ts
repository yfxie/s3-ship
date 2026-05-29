function escapeRegex(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, '\\$&')
}

function globToRegex(pattern: string): RegExp {
  let out = ''
  let i = 0
  while (i < pattern.length) {
    const c = pattern[i]!
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*'
        i += 2
        if (pattern[i] === '/') i++
      } else {
        out += '[^/]*'
        i++
      }
    } else if (c === '?') {
      out += '[^/]'
      i++
    } else {
      out += escapeRegex(c)
      i++
    }
  }
  return new RegExp(`^${out}$`)
}

export function matchesAnyGlob(key: string, patterns: string[]): boolean {
  return patterns.some((p) => globToRegex(p).test(key))
}

export function matchGlob(key: string, pattern: string): boolean {
  return globToRegex(pattern).test(key)
}
