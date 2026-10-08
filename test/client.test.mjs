/**
 * 客户端半边的冒烟测试：在没有浏览器、没有 cordis 的前提下把模块加载进 Node，
 * 断言「模块 id 正确、factory 能跑通、配置值的归一化与信任边界检查符合预期」。
 *
 * 运行：node test/client.test.mjs
 */
import { readFileSync } from 'node:fs'
import { strict as assert } from 'node:assert'

let registration
const windowStub = {
  __ModuleLoader__: {
    load(spec) {
      registration = spec
    },
  },
}

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
new Function('window', source)(windowStub)

assert.ok(registration, '客户端半边必须通过 window.__ModuleLoader__.load 注册')
assert.equal(registration.id, '@local/dsh-plugin-brand')

// 组件内部用到的 React 只会在渲染时被调用，这里给一个最小替身即可。
const reactStub = { createElement: () => null }
const mod = registration.factory((name) => {
  if (name === 'react') return reactStub
  throw new Error(`unexpected require: ${name}`)
})

assert.deepEqual(mod.inject, ['slots', 'locale', 'configForms'])
assert.equal(typeof mod.apply, 'function')

const { normalize, normalizeLogo, isImageSource, formatBytes, EMOJI_CHOICES, UPLOAD_MAX_BYTES } =
  mod.__internals

// 归一化：非字符串、空白、超长都要被收紧。
assert.equal(normalize(undefined, 10), '')
assert.equal(normalize(42, 10), '')
assert.equal(normalize('  hello  ', 10), 'hello')
assert.equal(normalize('abcdef', 3), 'abc')
assert.equal(normalize('探索未至之境', 60), '探索未至之境')

// logo 归一化：文本走剪裁，data URI 超限整体丢弃（截断只会得到坏图）。
assert.equal(normalizeLogo(undefined), '')
assert.equal(normalizeLogo('  https://example.com/a.png  '), 'https://example.com/a.png')
assert.equal(normalizeLogo('🐳'), '🐳')
const smallDataUri = `data:image/png;base64,${'A'.repeat(64)}`
assert.equal(normalizeLogo(smallDataUri), smallDataUri)
assert.equal(normalizeLogo(`data:image/png;base64,${'A'.repeat(400_001)}`), '')
// data URI 里的空白不会被 trim 掉（否则 base64 会损坏）。
assert.equal(normalizeLogo(`data:image/png;base64, AA`), `data:image/png;base64, AA`)

// 信任边界：只有 data:image/ 与 http(s) 能进 <img src>。
assert.equal(isImageSource('https://example.com/a.png'), true)
assert.equal(isImageSource('http://example.com/a.png'), true)
assert.equal(isImageSource('data:image/svg+xml;base64,AAAA'), true)
assert.equal(isImageSource('data:text/html,<script>'), false)
assert.equal(isImageSource('javascript:alert(1)'), false)
assert.equal(isImageSource('🐳'), false)

// emoji 候选：正好 50 个、互不重复、都是非空字符串。
assert.equal(EMOJI_CHOICES.length, 50)
assert.equal(new Set(EMOJI_CHOICES).size, 50)
assert.ok(EMOJI_CHOICES.every((emoji) => typeof emoji === 'string' && emoji.trim() !== ''))
// 候选必须能直接当 logo：既不是图片源，也能被 normalizeLogo 原样保留。
assert.ok(EMOJI_CHOICES.every((emoji) => !isImageSource(emoji) && normalizeLogo(emoji) === emoji))

// 上传上限是一个有限的正整数。
assert.ok(Number.isInteger(UPLOAD_MAX_BYTES) && UPLOAD_MAX_BYTES > 0)

assert.equal(formatBytes(512), '512 B')
assert.equal(formatBytes(2048), '2.0 KB')

console.log('client.test.mjs: all assertions passed')
