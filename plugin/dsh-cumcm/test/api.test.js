/**
 * 宿主侧接口测试（node:test + 真实 http server）
 *
 * 跑法: node --test test/api.test.js
 *
 * 覆盖：路由存在性、状态统计（含注释剔除）、同源/内容类型/白名单三道闸、PDF 缺件。
 * 不覆盖 spawn：DSH 沙箱下管道 stdio 会被 EPERM 拦掉，子进程执行走真机手测。
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { API_MOUNT, createApi, normalizeConfig } from '../lib/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixtures = path.join(here, 'fixtures')
const project = path.join(fixtures, '2025T')

const config = normalizeConfig({
  projectsRoot: fixtures,
  skillDir: path.join(fixtures, 'skill'),   // 只有 templates，没有 scripts：验证缺件分支
  allowAnyDir: false,
})

let server
let base

before(async () => {
  const handler = createApi(config)
  server = http.createServer((req, res) => {
    if (!req.url.startsWith(API_MOUNT)) {
      res.writeHead(404)
      res.end()
      return
    }
    handler(req, res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}${API_MOUNT}`
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
})

const get = (p, headers = {}) => fetch(base + p, { headers })
const post = (p, body, headers = {}) => fetch(base + p, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
})

test('GET /ping 返回版本与目录', async () => {
  const res = await get('/ping')
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.ok, true)
  assert.equal(data.version, '0.1.0')
  assert.equal(data.projectsRoot, fixtures)
})

test('GET /projects 能列出夹具项目', async () => {
  const data = await (await get('/projects')).json()
  assert.equal(data.ok, true)
  assert.equal(data.exists, true)
  assert.deepEqual(data.projects.map((p) => p.name), ['2025T'])
})

test('GET /status 统计正确且剔除注释里的占位符', async () => {
  const data = await (await get('/status?dir=' + encodeURIComponent(project))).json()
  assert.equal(data.ok, true)
  assert.equal(data.facts.length, 2)
  // rmse + cost_total + not_in_facts = 3 个不同 key；注释里的 commented_key 不算
  assert.equal(data.counts.res, 3)
  assert.deepEqual(data.counts.missingKeys, ['not_in_facts'])
  assert.equal(data.counts.aiflag, 1)
  assert.equal(data.files.pdf, false)
  assert.equal(data.skillReady, false)
})

test('GET /status 拒绝 projectsRoot 之外的目录', async () => {
  const outside = path.join(here, '..')
  const res = await get('/status?dir=' + encodeURIComponent(outside))
  assert.equal(res.status, 403)
  const data = await res.json()
  assert.equal(data.code, 'outside-root')
})

test('GET /status 拒绝不是数模工作区的目录', async () => {
  // fixtures 根本身在 projectsRoot 内，但没有 facts.json / paper.tex / analysis.md
  const res = await get('/status?dir=' + encodeURIComponent(fixtures))
  assert.equal(res.status, 422)
  assert.equal((await res.json()).code, 'not-project')
})

test('跨站请求被拒（Sec-Fetch-Site）', async () => {
  const res = await get('/status?dir=' + encodeURIComponent(project), { 'Sec-Fetch-Site': 'cross-site' })
  assert.equal(res.status, 403)
})

test('Origin 与 Host 不一致被拒', async () => {
  const res = await get('/ping', { Origin: 'https://evil.example' })
  assert.equal(res.status, 403)
})

test('写接口只接受 application/json', async () => {
  const res = await fetch(base + '/run', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: 'x',
  })
  assert.equal(res.status, 415)
})

test('POST /run 未知任务直接失败，不落子进程', async () => {
  const data = await (await post('/run', { dir: project, task: 'rm -rf /' })).json()
  assert.equal(data.ok, false)
  assert.match(data.output, /未知任务/)
})

test('POST /run 已知任务但 skill 缺件时报错而不是崩', async () => {
  const data = await (await post('/run', { dir: project, task: 'render' })).json()
  assert.equal(data.ok, false)
  assert.match(data.output, /找不到 render\.py/)
})

test('/text 白名单外路径被拒', async () => {
  const res = await get('/text?dir=' + encodeURIComponent(project) + '&path=' + encodeURIComponent('../../package.json'))
  assert.equal(res.status, 403)
})

test('/text 能读 facts.json', async () => {
  const data = await (await get('/text?dir=' + encodeURIComponent(project) + '&path=facts.json')).json()
  assert.equal(data.ok, true)
  assert.match(data.text, /rmse/)
})

test('/pdf 无产物时 404', async () => {
  const res = await get('/pdf?dir=' + encodeURIComponent(project) + '&which=paper')
  assert.equal(res.status, 404)
})

test('未知路由 404', async () => {
  const res = await get('/nope')
  assert.equal(res.status, 404)
})

test('POST /new 建工作区并拷模板（一题一目录，名字自定义）', async () => {
  const name = '夹具新题-01'
  const res = await post('/new', { name })
  assert.equal(res.status, 201)
  const data = await res.json()
  assert.equal(data.ok, true)
  assert.equal(data.name, name)
  const dir = path.join(fixtures, name)
  assert.ok(fs.existsSync(path.join(dir, 'paper', 'paper.tex')))
  assert.ok(fs.existsSync(path.join(dir, 'facts.json')))
  assert.ok(fs.existsSync(path.join(dir, 'analysis.md')))
  assert.ok(fs.existsSync(path.join(dir, 'ai_log')))
  assert.deepEqual(data.status.phases.map((p) => p.id), ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('POST /new 拒绝重名与非法名字', async () => {
  const dup = await post('/new', { name: '2025T' })
  assert.equal(dup.status, 409)
  assert.equal((await dup.json()).code, 'exists')

  for (const bad of ['../逃逸', 'a/b', '.hidden', '']) {
    const res = await post('/new', { name: bad })
    assert.ok([400, 422].includes(res.status), `名字 ${JSON.stringify(bad)} 应被拒，实际 ${res.status}`)
  }
})

test('GET /activity 给出时间线、代码与章节', async () => {
  const data = await (await get('/activity?dir=' + encodeURIComponent(project))).json()
  assert.equal(data.ok, true)
  assert.ok(Array.isArray(data.timeline))
  assert.ok(data.timeline.some((t) => t.file === 'facts.json'))
  assert.ok(Array.isArray(data.code))
  assert.ok(Array.isArray(data.sections))
})

test('POST /signoff 写入签字与改动记录', async () => {
  const name = '签字夹具'
  await post('/new', { name })
  const dir = path.join(fixtures, name)
  const changes = [
    '[P2] 假设 3 改为海面静止 ← 原假设与模型矛盾',
    '[P2] 符号表补上单位 ← 评审会查量纲',
    '[P3] 缺失值改中位数填充 ← 数据右偏',
    '[P4] 摘要补第三问数字 ← 原稿缺结论',
    '[P6] 图 2 图例移右上 ← 挡住条带',
  ]
  const res = await post('/signoff', {
    dir, reviewer: '张三', date: '2026-11-04', scopes: ['建模假设', '结果数值'],
    note: '整体通读一遍，问题三结论偏乐观', changes,
  })
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.ok, true)
  assert.equal(data.reviewer, '张三')
  assert.equal(data.changes, 5)

  const sign = fs.readFileSync(path.join(dir, 'ai_log', 'review_signoff.md'), 'utf8')
  assert.match(sign, /审核人：张三/)
  assert.match(sign, /2026-11-04/)
  assert.doesNotMatch(sign, /_{3,}/)

  const log = fs.readFileSync(path.join(dir, 'ai_log', 'changes.md'), 'utf8')
  assert.equal((log.match(/^- \[P/gm) || []).length, 5)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('POST /signoff 拦截空签字与不足 5 条改动', async () => {
  const noName = await post('/signoff', { dir: project, reviewer: '' })
  assert.equal(noName.status, 422)

  const few = await post('/signoff', {
    dir: project, reviewer: '李四', changes: ['[P1] 只有一条改动，不该通过'],
  })
  assert.equal(few.status, 422)
  assert.equal((await few.json()).code, 'too-few-changes')
})
