import { expect, test } from 'bun:test'
import { defineConfig } from '../../src/config/define.js'

test('defineConfig returns the input unchanged', () => {
  const cfg = { bucket: 'b', source: 'dist' }
  expect(defineConfig(cfg)).toBe(cfg)
})
