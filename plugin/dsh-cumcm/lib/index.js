/**
 * dsh-cumcm · Host half
 *
 * 数模台：给 math-modeling-cumcm skill 配一个「看得见的工作台」。
 *
 * 它只做四件事：
 *   1. 读工作区（analysis.md / facts.json / paper.tex / figs / PDF）算出 P0–P7 进度；
 *   2. 把 facts.json 变成台账，把 \res{} 与 \aiflag{} 数出来；
 *   3. 调 skill 里的 python 脚本（render / check / layout / appendix / compile / ai_report）；
 *   4. 把 PDF 流给前端。
 *
 * 设计约束（与社区插件一致）：
 *   - 只 inject `webServer`，其余一概不要；宿主小版本漂移时最坏是降级，不炸树。
 *   - 不自己维护第二份真相：一切以工作目录里的文件为准。
 *   - 手上不碰 shell 字符串拼接，全部 spawn + 参数数组。
 */

import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import Schema from '@deepseek-ai/schemastery'

export const name = 'dsh-cumcm'

/** 只强制依赖 webServer：没有它这个插件没有意义。 */
export const inject = ['webServer']

const PKG_VERSION = '0.1.0'

/** 路由挂载点：prefix 匹配的是 `/dsh-cumcm/api` 与 `/dsh-cumcm/api/...`，末尾不能带斜杠。 */
export const API_MOUNT = '/dsh-cumcm/api'

export const Config = Schema.object({
  skillDir: Schema.string().description('math-modeling-cumcm skill 目录；缺省 $DSH_HOME/skills/math-modeling-cumcm'),
  projectsRoot: Schema.string().description('work/ 根目录；缺省 ~/Desktop/DeepSeek/work'),
  pythonPath: Schema.string().description('Python 解释器；缺省自动探测 DSH 自带 runtime'),
  allowAnyDir: Schema.boolean().default(false).description('允许打开 projectsRoot 之外的目录'),
  taskTimeoutMs: Schema.number().default(180000).description('单个脚本超时（毫秒）；编译另有更长上限'),
}).default({})

const TASKS = {
  render: { script: 'render.py', args: (dir) => [dir], timeout: 60_000 },
  check: { script: 'check.py', args: (dir) => [dir, '--strict'], timeout: 120_000 },
  layout: { script: 'layout.py', args: (dir) => [dir], timeout: 60_000 },
  appendix: { script: 'appendix.py', args: (dir) => [dir], timeout: 60_000 },
  compile: { script: 'compile.py', args: (dir) => [dir], timeout: 600_000 },
  ai: { script: 'ai_report.py', args: (dir) => [dir], timeout: 600_000 },
}

/** 面板允许直接读的文本文件（相对工作区），白名单而不是黑名单。 */
const TEXT_WHITELIST = new Set([
  'facts.json',
  'analysis.md',
  'review.md',
  'paper/paper.tex',
  'ai_log/env.md',
  'ai_log/session.md',
  'ai_log/changes.md',
  'ai_log/decisions.md',
  'ai_log/review_signoff.md',
])

const MAX_BODY = 1 << 20
const MAX_OUTPUT = 20_000

function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim()) return path.resolve(fromEnv)
  return path.join(os.homedir(), '.dsh')
}

function expandHome(value) {
  if (!value) return value
  if (value === '~') return os.homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(os.homedir(), value.slice(2))
  return value
}

export function normalizeConfig(raw) {
  const input = raw && typeof raw === 'object' ? raw : {}
  const skillDir = path.resolve(expandHome(input.skillDir) || path.join(dshHome(), 'skills', 'math-modeling-cumcm'))
  const projectsRoot = path.resolve(expandHome(input.projectsRoot) || path.join(os.homedir(), 'Desktop', 'DeepSeek', 'work'))
  const bundled = path.join(dshHome(), 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'python', 'python.exe')
  const pythonPath = input.pythonPath
    ? path.resolve(expandHome(input.pythonPath))
    : (existsSync(bundled) ? bundled : 'python')
  const timeout = Number(input.taskTimeoutMs)
  return {
    skillDir,
    projectsRoot,
    pythonPath,
    allowAnyDir: input.allowAnyDir === true,
    taskTimeoutMs: Number.isFinite(timeout) && timeout > 1000 ? timeout : 180_000,
  }
}

// ---------------------------------------------------------------- 工具

function json(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(body)
}

class BizError extends Error {
  constructor(code, status, message) {
    super(message)
    this.code = code
    this.status = status
  }
}

function isInside(root, target) {
  const rel = path.relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function readJsonSync(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function readTextSync(file, limit = 2_000_000) {
  try {
    const buf = readFileSync(file)
    return buf.subarray(0, limit).toString('utf8')
  } catch {
    return ''
  }
}

/** 工作区识别：至少有一个能证明"这是个数模工作区"的标记。 */
function looksLikeProject(dir) {
  return ['facts.json', path.join('paper', 'paper.tex'), 'analysis.md']
    .some((rel) => existsSync(path.join(dir, rel)))
}

function resolveProject(rawDir, config) {
  const raw = typeof rawDir === 'string' ? rawDir.trim() : ''
  if (!raw) throw new BizError('no-dir', 400, '缺少 dir 参数')
  const dir = path.resolve(expandHome(raw))
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new BizError('no-dir', 404, `目录不存在：${dir}`)
  }
  if (!config.allowAnyDir && !isInside(config.projectsRoot, dir)) {
    throw new BizError('outside-root', 403, `只允许打开 ${config.projectsRoot} 下的目录（可在插件配置里开 allowAnyDir）`)
  }
  if (!looksLikeProject(dir)) {
    throw new BizError('not-project', 422, '这个目录不像数模工作区（缺 facts.json / paper/paper.tex / analysis.md）')
  }
  return dir
}

function countMatches(text, re) {
  return (text.match(re) || []).length
}

/** 去掉 LaTeX 注释：注释里的 \res{key} 是说明文字，不该被当成正文引用。 */
function stripTexComments(text) {
  return text.split('\n').map((line) => {
    let out = ''
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]
      if (ch === '%' && (i === 0 || line[i - 1] !== '\\')) break
      out += ch
    }
    return out
  }).join('\n')
}

/** P0–P7 进度：靠磁盘上的产物判断，不靠对话记忆。 */
function buildPhases(dir) {
  const has = (rel) => existsSync(path.join(dir, rel))
  const analysis = readTextSync(path.join(dir, 'analysis.md'))
  const facts = readJsonSync(path.join(dir, 'facts.json'))
  const values = facts && typeof facts.values === 'object' ? facts.values : {}
  const tex = readTextSync(path.join(dir, 'paper', 'paper.tex'))
  const figs = has('paper/figs') ? readdirSync(path.join(dir, 'paper', 'figs')) : []
  const pdf = has('paper/paper.rendered.pdf')
  const aiPdf = has('支撑材料/AI 工具使用详情.pdf')
  // 签字不能只看有没有「审核人」三个字：模板本身就带这三个字。
  // 必须有非下划线的姓名，且没有留下 ____ 空白。
  const signoffText = readTextSync(path.join(dir, 'ai_log', 'review_signoff.md')) || ''
  const signoff = /审核人[:：]\s*[^\s_＿]/.test(signoffText) && !/_{3,}|＿{3,}/.test(signoffText)

  return [
    { id: 'P0', name: '环境', done: has('problem') || analysis.length > 0, detail: has('problem') ? '原题已归档' : '未见 problem/' },
    { id: 'P1', name: '破题', done: /问题拆解|数据体检|洞察/.test(analysis), detail: analysis ? `${analysis.length} 字` : '无 analysis.md' },
    { id: 'P2', name: '建模', done: /模型|假设|符号/.test(analysis) && analysis.length > 600, detail: /符号/.test(analysis) ? '含符号表' : '待补符号表' },
    { id: 'P3', name: '求解', done: Object.keys(values).length > 0, detail: `${Object.keys(values).length} 条 fact` },
    { id: 'P4', name: '写作', done: tex.length > 2000, detail: tex ? `${tex.length} 字符` : '无 paper.tex' },
    { id: 'P5', name: '图表', done: figs.filter((f) => /\.(pdf|png|jpg|jpeg)$/i.test(f)).length > 0, detail: `${figs.length} 个文件` },
    { id: 'P6', name: '自检', done: pdf, detail: pdf ? 'PDF 已出' : '未编译' },
    { id: 'P7', name: '合规', done: aiPdf && signoff, detail: aiPdf ? (signoff ? '材料齐 + 已签字' : '缺签字') : '缺 AI 详情 PDF' },
  ]
}

function buildFacts(dir) {
  const facts = readJsonSync(path.join(dir, 'facts.json'))
  const values = facts && typeof facts.values === 'object' ? facts.values : {}
  return Object.entries(values).map(([key, spec]) => ({
    key,
    value: spec && typeof spec === 'object' ? spec.value : spec,
    unit: (spec && spec.unit) || '',
    desc: (spec && spec.desc) || '',
    source: (spec && spec.source) || '',
    check: (spec && spec.check) || '',
  }))
}

function buildStatus(dir, config) {
  const texRaw = readTextSync(path.join(dir, 'paper', 'paper.tex'))
  const tex = stripTexComments(texRaw)
  const phases = buildPhases(dir)
  const facts = buildFacts(dir)
  const resKeys = [...new Set((tex.match(/\\res\{([A-Za-z0-9_]+)\}/g) || []).map((m) => m.slice(5, -1)))]
  const missing = resKeys.filter((k) => !facts.some((f) => f.key === k))
  return {
    dir,
    name: path.basename(dir),
    phases,
    done: phases.filter((p) => p.done).length,
    facts,
    counts: {
      facts: facts.length,
      res: resKeys.length,
      missingRes: missing.length,
      missingKeys: missing,
      aiflag: countMatches(tex, /\\aiflag\{/g),
      todo: countMatches(tex, /TODO\(人工\)/g),
      figures: countMatches(tex, /\\begin\{figure\}/g),
      tables: countMatches(tex, /\\begin\{table\}/g),
    },
    files: {
      pdf: existsSync(path.join(dir, 'paper', 'paper.rendered.pdf')),
      aiPdf: existsSync(path.join(dir, '支撑材料', 'AI 工具使用详情.pdf')),
    },
    skillDir: config.skillDir,
    skillReady: existsSync(path.join(config.skillDir, 'scripts', 'check.py')),
  }
}

const WORKSPACE_NAME = /^[\p{Script=Han}A-Za-z0-9][\p{Script=Han}A-Za-z0-9 _.\-]{0,39}$/u

/** 论文章节清单：标题 + 该节中文字数（只看 \\section，附录之后的跳过）。 */
function parseSections(tex) {
  if (!tex) return []
  const body = tex.split('\\appendix')[0]
  const re = /\\section\*?\{([^}]*)\}/g
  const marks = []
  let m
  while ((m = re.exec(body)) !== null) marks.push({ title: m[1].trim(), at: m.index })
  return marks.map((s, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].at : body.length
    const chunk = body.slice(s.at, end)
    const cn = (chunk.match(/[\u4e00-\u9fff]/g) || []).length
    return { title: s.title, chars: cn }
  })
}

/** 过程视图：做过什么、什么时候做的、产出多大。 */
function buildActivity(dir) {
  const at = (rel) => {
    try {
      return statSync(path.join(dir, rel)).mtimeMs
    } catch {
      return 0
    }
  }
  const codeDir = path.join(dir, 'code')
  const code = []
  if (existsSync(codeDir)) {
    for (const name of readdirSync(codeDir)) {
      if (!/\.(py|mjs|js|m|r)$/i.test(name)) continue
      const full = path.join(codeDir, name)
      try {
        const st = statSync(full)
        if (!st.isFile()) continue
        const text = readFileSync(full, 'utf8')
        code.push({
          name,
          lines: text.split('\n').length,
          kb: Math.max(1, Math.round(st.size / 1024)),
          at: st.mtimeMs,
        })
      } catch {
        /* 忽略读不到的文件 */
      }
    }
  }
  const tex = readTextSync(path.join(dir, 'paper', 'paper.tex'))
  const sections = parseSections(tex)

  const timeline = [
    { label: '赛题与破题', file: 'analysis.md', at: at('analysis.md') },
    { label: '数值台账', file: 'facts.json', at: at('facts.json') },
    { label: '图表', file: 'paper/figs', at: code.length ? Math.max(...code.map((c) => c.at)) : 0 },
    { label: '论文源码', file: 'paper/paper.tex', at: at(path.join('paper', 'paper.tex')) },
    { label: '论文 PDF', file: 'paper/paper.rendered.pdf', at: at(path.join('paper', 'paper.rendered.pdf')) },
    { label: '合规材料', file: '支撑材料/AI 工具使用详情.pdf', at: at(path.join('支撑材料', 'AI 工具使用详情.pdf')) },
  ].filter((t) => t.at > 0).sort((a, b) => a.at - b.at)

  return { code, sections, timeline }
}

/**
 * 人工审核签字：把面板上填的内容落成 review_signoff.md 与 changes.md。
 * 这里只负责写文件——内容必须是人填的，AI 不代填、不代签。
 */
function writeSignoff(dir, body) {
  const reviewer = String(body.reviewer || '').trim()
  if (!reviewer) throw new BizError('no-reviewer', 422, '签字必须有审核人姓名')
  if (reviewer.length > 40) throw new BizError('bad-reviewer', 422, '姓名太长了')
  const date = String(body.date || '').trim() || new Date().toISOString().slice(0, 10)
  const scopes = Array.isArray(body.scopes) ? body.scopes.filter((s) => typeof s === 'string') : []
  const note = String(body.note || '').trim()
  const changes = (Array.isArray(body.changes) ? body.changes : [])
    .map((s) => String(s).trim())
    .filter((s) => s.length >= 8)
  if (changes.length && changes.length < 5) {
    throw new BizError('too-few-changes', 422, `改动记录只有 ${changes.length} 条，至少要 5 条`)
  }

  const logDir = path.join(dir, 'ai_log')
  mkdirSync(logDir, { recursive: true })

  const scopeLine = scopes.length ? scopes.join('、') : '（未勾选）'
  const sign = [
    '# 人工审核签字',
    '',
    `- 审核人：${reviewer}`,
    `- 日期：${date}`,
    `- 审核范围：${scopeLine}`,
    '',
    '## 确认结论',
    '',
    '☑ 已实质审核并修改，同意作为队伍初稿',
    '',
    '## 审核备注',
    '',
    note || '（无）',
    '',
    '---',
    '本页由审核人通过「数模台」填写，内容未经 AI 加工。',
  ].join('\n') + '\n'
  writeFileSync(path.join(logDir, 'review_signoff.md'), sign, 'utf8')

  let written = 0
  if (changes.length) {
    const file = path.join(logDir, 'changes.md')
    const head = existsSync(file) ? readFileSync(file, 'utf8') : '# 人工修改记录\n\n'
    const base = head.replace(/\n- \s*\n/g, '\n')   // 去掉空槽位
    const block = changes.map((c) => `- ${c}`).join('\n')
    writeFileSync(file, base.trimEnd() + '\n\n' + block + '\n', 'utf8')
    written = changes.length
  }

  return { reviewer, date, scopes, changes: written }
}

// ---------------------------------------------------------------- PDF 预览与系统打开
//
// 为什么要绕这一圈：DSH 的外层窗口对 window.open 做了
//   setWindowOpenHandler(({url}) => { if (url.protocol === 'https:') shell.openExternal(url); return {action:'deny'} })
// 本地 http://127.0.0.1 的 PDF 会被直接拒绝，连错误都没有。
// 所以：预览走「宿主把某一页转成 PNG，面板当图片显示」；要真 PDF 就走系统默认程序。

// os.tmpdir() 在 DSH 里是「每次进程一个」的沙箱临时目录，预览缓存放这儿会随重启消失；
// 放到 $DSH_HOME/cache 下更稳。首次预览时才建目录。
const PREVIEW_DIR = path.join(dshHome(), 'cache', 'cumcm-preview')

function pdfFile(dir, which) {
  return which === 'ai'
    ? path.join(dir, '支撑材料', 'AI 工具使用详情.pdf')
    : path.join(dir, 'paper', 'paper.rendered.pdf')
}

function findPdftoppm() {
  const exe = process.platform === 'win32' ? 'pdftoppm.exe' : 'pdftoppm'
  const candidates = [
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64', exe),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'MiKTeX', 'miktex', 'bin', 'x64', exe),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** 把 PDF 的某一页转成 PNG（带缓存），返回文件路径。 */
export function renderPdfPage(file, page) {
  const tool = findPdftoppm()
  if (!tool) throw new BizError('no-pdftoppm', 501, '找不到 pdftoppm（MiKTeX 自带），无法预览')
  mkdirSync(PREVIEW_DIR, { recursive: true })
  const st = statSync(file)
  const key = `${path.basename(file, '.pdf')}-${st.size}-${Math.round(st.mtimeMs)}-p${page}`
    .replace(/[^\w.-]/g, '_')
  const out = path.join(PREVIEW_DIR, key)
  if (existsSync(out + '.png')) return out + '.png'

  const proc = spawnSync(tool, ['-png', '-r', '110', '-f', String(page), '-l', String(page), '-singlefile', file, out], {
    windowsHide: true,
    timeout: 20_000,
    // 不用管道：DSH 沙箱下带 stdio 管道的子进程会 EPERM；结果看文件是否生成即可
    stdio: 'ignore',
  })
  if (proc.status !== 0 || !existsSync(out + '.png')) {
    throw new BizError('preview-failed', 500, `预览失败：pdftoppm 退出码 ${proc.status ?? '无'}（页数越界或环境缺失）`)
  }
  return out + '.png'
}



/**
 * 新建一个工作区：一题一目录，名字由使用者定（不绑年份）。
 * 只做两件事：建骨架、拷模板；赛题本身由对话里的 agent 读进 problem/。
 */
function createWorkspace(rawName, config) {
  const name = String(rawName || '').trim()
  if (!name) throw new BizError('no-name', 400, '给工作区起个名字')
  if (!WORKSPACE_NAME.test(name) || name.includes('..')) {
    throw new BizError('bad-name', 422, '名字只能用中英文、数字、空格和 -_. ，且不超过 40 字')
  }
  const root = config.projectsRoot
  const dir = path.join(root, name)
  if (existsSync(dir)) throw new BizError('exists', 409, `工作区已存在：${name}`)

  for (const sub of ['paper/figs', 'code', 'ai_log', 'problem']) {
    mkdirSync(path.join(dir, sub), { recursive: true })
  }

  const templates = path.join(config.skillDir, 'templates')
  const copied = []
  const plan = [
    ['paper.tex', path.join('paper', 'paper.tex')],
    ['facts.json', 'facts.json'],
    ['analysis.md', 'analysis.md'],
  ]
  for (const [from, to] of plan) {
    const src = path.join(templates, from)
    if (!existsSync(src)) continue
    copyFileSync(src, path.join(dir, to))
    copied.push(to)
  }

  // 赛题由使用者在对话里发过来，agent 读完后落 problem/；这里先留一张期票
  const readme = [
    `# ${name}`,
    '',
    '赛题文件由使用者发到对话里，agent 读取后放进 `problem/`。',
    '工作台的操作（注入数值 / 体检 / 收附录 / 编译 / 合规材料）全在「数模台」面板里点。',
    '',
    '## 目录',
    '- `problem/` 原题与附件',
    '- `analysis.md` 破题 → 假设 → 符号（唯一真值源）',
    '- `facts.json` 数值台账（只由求解脚本写入）',
    '- `paper/` 论文源文件与图表',
    '- `ai_log/` 交互记录、改动、签字',
  ].join('\n') + '\n'
  writeFileSync(path.join(dir, 'README.md'), readme, 'utf8')

  return { dir, name, copied }
}

function listProjects(config) {  const root = config.projectsRoot
  if (!existsSync(root)) {
    return { root, exists: false, projects: [] }
  }
  const projects = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => path.join(root, e.name))
    .filter(looksLikeProject)
    .map((dir) => {
      try {
        const st = statSync(dir)
        return { name: path.basename(dir), dir, mtime: st.mtimeMs }
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime)
  return { root, exists: true, projects }
}

// ---------------------------------------------------------------- 跑脚本

function runTask(task, dir, config) {
  return new Promise((resolve) => {
    const spec = TASKS[task]
    if (!spec) return resolve({ ok: false, code: -1, output: `未知任务：${task}` })
    if (!existsSync(path.join(config.skillDir, 'scripts', spec.script))) {
      return resolve({ ok: false, code: -1, output: `找不到 ${spec.script}，skill 目录是不是配错了？${config.skillDir}` })
    }

    const started = Date.now()
    const child = spawn(config.pythonPath, [path.join('scripts', spec.script), ...spec.args(dir)], {
      cwd: config.skillDir,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    })

    let out = ''
    const push = (chunk) => {
      out += chunk.toString('utf8')
      if (out.length > MAX_OUTPUT) out = out.slice(-MAX_OUTPUT)
    }
    child.stdout.on('data', push)
    child.stderr.on('data', push)

    const limit = Math.max(spec.timeout, config.taskTimeoutMs)
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* 已退出 */ }
      resolve({ ok: false, code: -1, output: `${out}\n[超时] 超过 ${Math.round(limit / 1000)} 秒被中止` })
    }, limit)

    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ ok: false, code: -1, output: `${out}\n[启动失败] ${err.message}` })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, code, output: out.trim(), ms: Date.now() - started })
    })
  })
}

// ---------------------------------------------------------------- HTTP

function assertSameOrigin(req) {
  // 威胁模型不是同机进程，而是浏览器里的第三方页面借用户身份打 loopback。
  const site = req.headers['sec-fetch-site']
  if (site === 'cross-site') throw new BizError('cross-site', 403, '拒绝跨站请求')
  const origin = req.headers.origin
  const host = req.headers.host
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) throw new BizError('bad-origin', 403, 'Origin 与 Host 不一致')
    } catch (err) {
      if (err instanceof BizError) throw err
      throw new BizError('bad-origin', 403, 'Origin 解析失败')
    }
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new BizError('too-large', 413, '请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new BizError('bad-json', 400, '请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

export function createApi(config) {
  return async function handler(req, res) {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`)
    const route = url.pathname.replace(API_MOUNT, '') || '/'
    const method = (req.method || 'GET').toUpperCase()

    try {
      assertSameOrigin(req)

      if (route === '/ping' && method === 'GET') {
        return json(res, 200, { ok: true, version: PKG_VERSION, skillDir: config.skillDir, projectsRoot: config.projectsRoot })
      }

      if (route === '/new' && method === 'POST') {
        const type = (req.headers['content-type'] || '').toLowerCase()
        if (!type.includes('application/json')) {
          throw new BizError('need-json', 415, '写接口只接受 application/json')
        }
        const body = await readBody(req)
        const created = createWorkspace(body.name, config)
        return json(res, 201, { ok: true, ...created, status: buildStatus(created.dir, config) })
      }

      if (route === '/activity' && method === 'GET') {
        const dir = resolveProject(url.searchParams.get('dir'), config)
        return json(res, 200, { ok: true, ...buildActivity(dir) })
      }

      if (route === '/signoff' && method === 'POST') {
        const type = (req.headers['content-type'] || '').toLowerCase()
        if (!type.includes('application/json')) {
          throw new BizError('need-json', 415, '写接口只接受 application/json')
        }
        const body = await readBody(req)
        const dir = resolveProject(body.dir, config)
        const saved = writeSignoff(dir, body)
        return json(res, 200, { ok: true, ...saved, status: buildStatus(dir, config) })
      }

      if (route === '/preview' && method === 'GET') {
        const dir = resolveProject(url.searchParams.get('dir'), config)
        const which = url.searchParams.get('which') === 'ai' ? 'ai' : 'paper'
        const page = Math.max(1, Math.min(200, Number(url.searchParams.get('page') || 1) || 1))
        const file = pdfFile(dir, which)
        if (!existsSync(file)) throw new BizError('no-file', 404, '还没有 PDF，先编译')
        const png = renderPdfPage(file, page)
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': statSync(png).size,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        })
        return createReadStream(png).pipe(res)
      }

      if (route === '/open' && method === 'POST') {
        const type = (req.headers['content-type'] || '').toLowerCase()
        if (!type.includes('application/json')) {
          throw new BizError('need-json', 415, '写接口只接受 application/json')
        }
        const body = await readBody(req)
        const dir = resolveProject(body.dir, config)
        const which = body.which === 'ai' ? 'ai' : 'paper'
        const file = pdfFile(dir, which)
        if (!existsSync(file)) throw new BizError('no-file', 404, '还没有 PDF，先编译')
        // 只用系统默认程序打开这两个已知文件，不接收任意路径
        const child = spawn(process.platform === 'win32' ? 'explorer.exe' : 'xdg-open', [file], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        })
        child.unref()
        return json(res, 200, { ok: true, opened: file })
      }

      if (route === '/projects' && method === 'GET') {
        return json(res, 200, { ok: true, ...listProjects(config) })
      }

      if (route === '/status' && method === 'GET') {
        const dir = resolveProject(url.searchParams.get('dir'), config)
        return json(res, 200, { ok: true, ...buildStatus(dir, config) })
      }

      if (route === '/text' && method === 'GET') {
        const dir = resolveProject(url.searchParams.get('dir'), config)
        const rel = (url.searchParams.get('path') || '').replace(/\\/g, '/')
        if (!TEXT_WHITELIST.has(rel)) throw new BizError('not-allowed', 403, `不允许读取 ${rel}`)
        const file = path.join(dir, rel)
        if (!existsSync(file)) throw new BizError('no-file', 404, `文件不存在：${rel}`)
        const text = await readFile(file, 'utf8')
        return json(res, 200, { ok: true, path: rel, text: text.slice(0, 400_000) })
      }

      if (route === '/pdf' && method === 'GET') {
        const dir = resolveProject(url.searchParams.get('dir'), config)
        const which = url.searchParams.get('which') === 'ai' ? 'ai' : 'paper'
        const file = which === 'ai'
          ? path.join(dir, '支撑材料', 'AI 工具使用详情.pdf')
          : path.join(dir, 'paper', 'paper.rendered.pdf')
        if (!existsSync(file)) throw new BizError('no-file', 404, '还没有 PDF，先编译')
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Length': statSync(file).size,
          'Content-Disposition': 'inline; filename="paper.pdf"',
          'X-Content-Type-Options': 'nosniff',
        })
        return createReadStream(file).pipe(res)
      }

      if (route === '/run' && method === 'POST') {
        const type = (req.headers['content-type'] || '').toLowerCase()
        if (!type.includes('application/json')) {
          throw new BizError('need-json', 415, '写接口只接受 application/json')
        }
        const body = await readBody(req)
        const dir = resolveProject(body.dir, config)
        const task = String(body.task || '')
        const result = await runTask(task, dir, config)
        return json(res, 200, { ok: result.ok, task, ...result, status: buildStatus(dir, config) })
      }

      throw new BizError('not-found', 404, `未知接口：${method} ${route}`)
    } catch (err) {
      if (err instanceof BizError) return json(res, err.status, { ok: false, code: err.code, message: err.message })
      return json(res, 500, { ok: false, code: 'internal', message: err instanceof Error ? err.message : String(err) })
    }
  }
}

export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API_MOUNT,
    handler: createApi(config),
  }), 'dsh-cumcm: /dsh-cumcm/api routes')

  ctx.logger?.info?.(`[dsh-cumcm] ready · skill=${config.skillDir} · projects=${config.projectsRoot}`)
}
