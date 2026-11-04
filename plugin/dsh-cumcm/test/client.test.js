/**
 * 浏览器半边测试：注册契约 + 真实 React 渲染
 *
 * 跑法: node test/client.test.js
 *
 * 它做三件事（都是踩过坑换来的）：
 *   1. 用桩 loader 执行 client.js —— 语法错/引用错会在这里炸出来；
 *   2. 断言 locale / tab / slot 三处注册真的发生，且 key 与 id 一致；
 *   3. 用**真实 React** 做一次 SSR 渲染 —— 组件首屏崩不崩，这里能抓到。
 *
 * 注意：本文件必须能被直接执行（node test/client.test.js），
 * 不要用 `node --test`（它会拆子进程，沙箱下 spawn 会 EPERM）。
 */

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const clientPath = path.join(here, '..', 'lib', 'client.js')

const requireProfile = createRequire('C:/Users/ROG/.dsh/profiles/desktop/')
let React
let renderToStaticMarkup
try {
  React = requireProfile('react')
  renderToStaticMarkup = requireProfile('react-dom/server').renderToStaticMarkup
} catch {
  // 没有 React 时退化成桩渲染（仍能抓注册与语法问题）
  React = {
    createElement: (type, props, ...kids) => ({ type, props, kids }),
    useState: (init) => [init, () => {}],
    useEffect: () => {},
  }
  renderToStaticMarkup = (el) => JSON.stringify(el, (k, v) => (typeof v === 'function' ? '[fn]' : v))
}

const calls = []
let Panel = null
const ctx = {
  effect: (fn, label) => {
    try { return fn() } catch (e) { calls.push(['effect-error', label, e.message]) }
  },
  locale: {
    register: (ns, dict) => { calls.push(['locale', ns, Object.keys(dict.zh).length]); return () => {} },
    bind: () => (k) => k,
  },
  sidebarRightTabs: {
    register: (def) => {
      calls.push(['tab', def.id, def.kind, Array.isArray(def.guide) ? def.guide.length : 0, typeof def.title])
      return () => {}
    },
  },
  slots: {
    inject: (name, make) => {
      calls.push(['slot.inject', name])
      if (typeof make === 'function') make()
      return () => {}
    },
    register: (meta, comp) => { Panel = comp; calls.push(['slot.register', meta.name, meta.key]); return () => {} },
  },
}

globalThis.window = {
  __ModuleLoader__: {
    load: ({ id, factory }) => {
      const mod = factory((name) => (name === 'react' ? React : {}))
      calls.push(['loaded', id, mod.name, mod.inject.join('+'), typeof mod.apply])
      mod.apply(ctx)
    },
  },
}

// 以 data URL 引入，避免 Node 把浏览器侧代码当 ESM 解析
const source = fs.readFileSync(clientPath, 'utf8')
await import('data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64'))

const step = (name, fn) => {
  try {
    fn()
    console.log('✔ ' + name)
    return true
  } catch (e) {
    console.log('✖ ' + name + ' :: ' + e.message)
    process.exitCode = 1
    return false
  }
}

step('模块装载并导出 name/inject/apply', () => {
  const loaded = calls.find((c) => c[0] === 'loaded')
  assert.ok(loaded, '没有执行 loader.load')
  assert.equal(loaded[1], 'dsh-cumcm')
  assert.equal(loaded[2], 'dsh-cumcm')
  assert.equal(loaded[3], 'slots+locale+sidebarRightTabs')
  assert.equal(loaded[4], 'function')
})

step('注册了字典（中英同键集）', () => {
  const dict = calls.find((c) => c[0] === 'locale')
  assert.ok(dict, '没有注册 locale')
  assert.equal(dict[1], 'cumcm')
  assert.ok(dict[2] >= 20, '字典条目太少：' + dict[2])
})

step('tab 类型注册且 id === kind', () => {
  const tab = calls.find((c) => c[0] === 'tab')
  assert.ok(tab, '没有注册 tab 类型')
  assert.equal(tab[1], 'cumcm')
  assert.equal(tab[2], 'cumcm')
  assert.equal(tab[3], 1, '引导页入口应为 1 条')
  assert.equal(tab[4], 'function', 'title 应是函数（延迟取词）')
})

step('面板注册在 sidebar.right.pane.tab 且 key 与 id 一致', () => {
  const slot = calls.find((c) => c[0] === 'slot.register')
  assert.ok(slot, '没有注册面板')
  assert.equal(slot[1], 'sidebar.right.pane.tab')
  assert.equal(slot[2], 'cumcm')
  assert.equal(typeof Panel, 'function')
})

step('effect 里没有抛错', () => {
  const err = calls.find((c) => c[0] === 'effect-error')
  assert.equal(err, undefined, err ? err[1] + ': ' + err[2] : '')
})

step('首屏渲染不崩且包含关键文字', () => {
  const html = renderToStaticMarkup(React.createElement(Panel, {}))
  assert.ok(html.length > 200, '渲染结果过短：' + html.length)
  // 桩渲染时内容是 JSON，真实渲染时是 HTML，两种都要能命中
  assert.ok(html.includes('数模台'), '缺标题')
  assert.ok(html.includes('还没有工作区') || html.includes('工作区'), '缺空态提示')
})

console.log('\n' + (process.exitCode ? 'FAIL' : 'PASS'))
