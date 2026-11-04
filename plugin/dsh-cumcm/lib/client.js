/**
 * dsh-cumcm · Client half
 *
 * 浏览器侧只做两件事：
 *   1. 往右侧栏注册一个 tab 类型 `cumcm`（带引导页入口）；
 *   2. 在 `sidebar.right.pane.tab` 里渲染「数模台」面板。
 *
 * 数据全部来自 Host 的 `/dsh-cumcm/api/`：这里不读文件、不猜路径、不拼命令。
 * 工程约束：纯 JS、零构建、零运行时依赖，只 require('react')；注册全走 ctx.effect。
 */
;(function () {
  'use strict'

  var loader = typeof window !== 'undefined' ? window.__ModuleLoader__ : undefined
  if (!loader || typeof loader.load !== 'function') return

  loader.load({
    id: 'dsh-cumcm',
    factory: function (require) {
      var module = { exports: {} }
      var exports = module.exports
      Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

      var React = require('react')
      var h = React.createElement

      var NS = 'cumcm'
      var KIND = 'cumcm'
      var API = '/dsh-cumcm/api'

      var zh = {
        'tab.title': '数模台',
        'tab.guide': '打开数模台',
        'tab.guideDesc': '看 P0–P7 进度、事实台账，一键体检与编译论文 PDF。',
        'pick': '工作区',
        'new.placeholder': '新建工作区，如 电池寿命预测',
        'new.button': '新建',
        'new.exists': '这个工作区已经存在了',
        'empty.title': '还没有工作区',
        'empty.hint': '在 projectsRoot 下建 work/<题号>/，放进 facts.json 与 paper/paper.tex 就会出现在这里。',
        'refresh': '刷新',
        'facts': '事实台账',
        'counts': '体检数字',
        'run.render': '注入数值',
        'run.check': '合规自检',
        'run.layout': '排版体检',
        'run.appendix': '收附录',
        'run.compile': '编译 PDF',
        'run.ai': '合规材料',
        'open.pdf': '打开论文 PDF',
        'open.ai': '打开 AI 详情',
        'nofacts': 'facts.json 还是空的——先让求解脚本写数。',
        'running': '运行中…',
        'output': '输出',
        'ready': '就绪',
        'missingSkill': 'skill 目录没找到，检查插件配置里的 skillDir。',
      }

      var en = {
        'tab.title': 'CUMCM',
        'tab.guide': 'Open the modeling desk',
        'tab.guideDesc': 'Phase progress, fact ledger, one-click checks and PDF build.',
        'pick': 'Workspace',
        'new.placeholder': 'New workspace, e.g. battery-life',
        'new.button': 'Create',
        'new.exists': 'Workspace already exists',
        'empty.title': 'No workspace yet',
        'empty.hint': 'Create work/<id>/ under projectsRoot with facts.json and paper/paper.tex.',
        'refresh': 'Refresh',
        'facts': 'Facts',
        'counts': 'Counts',
        'run.render': 'Render',
        'run.check': 'Check',
        'run.layout': 'Layout',
        'run.appendix': 'Appendix',
        'run.compile': 'Build PDF',
        'run.ai': 'AI report',
        'open.pdf': 'Open paper PDF',
        'open.ai': 'Open AI report',
        'nofacts': 'facts.json is empty — let the solver write numbers first.',
        'running': 'Running…',
        'output': 'Output',
        'ready': 'Ready',
        'missingSkill': 'Skill dir not found; check skillDir in plugin config.',
      }

      var TASKS = [
        { id: 'render', label: 'run.render' },
        { id: 'check', label: 'run.check' },
        { id: 'layout', label: 'run.layout' },
        { id: 'appendix', label: 'run.appendix' },
        { id: 'compile', label: 'run.compile' },
        { id: 'ai', label: 'run.ai' },
      ]

      var C = {
        fg: 'var(--dsw-static-foreground, #1f2328)',
        muted: 'var(--dsw-static-muted, #6b7280)',
        line: 'var(--dsw-static-border, rgba(0,0,0,0.12))',
        bg: 'var(--dsw-static-surface, #f6f7f9)',
        accent: 'var(--dsw-static-accent, #2f6f9f)',
        ok: '#2f8a52',
        warn: '#b08a3e',
        err: '#c2553b',
      }

      function api(path, options) {
        return fetch(API + path, options).then(function (res) {
          return res.json().then(function (data) {
            return { res: res, data: data }
          })
        })
      }

      function getJson(path) {
        return api(path).then(function (r) {
          if (!r.data || r.data.ok === false) throw new Error((r.data && r.data.message) || '请求失败')
          return r.data
        })
      }

      function postJson(path, body) {
        return api(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).then(function (r) {
          if (!r.data) throw new Error('空响应')
          return r.data
        })
      }

      function Dot(props) {
        var done = props.done
        return h('span', {
          title: props.detail,
          style: {
            display: 'inline-flex', alignItems: 'center', gap: '4px',
            padding: '2px 7px', borderRadius: '999px', fontSize: '11px',
            border: '1px solid ' + (done ? C.ok : C.line),
            color: done ? C.ok : C.muted,
            background: done ? 'rgba(47,138,82,0.08)' : 'transparent',
          },
        }, h('span', { style: { fontWeight: 600 } }, props.id), props.name)
      }

      function Tiny(props) {
        return h('div', { style: { fontSize: '11px', color: C.muted, lineHeight: 1.5 } }, props.children)
      }

      function Section(props) {
        return h('div', { style: { padding: '10px 12px', borderTop: '1px solid ' + C.line } },
          h('div', { style: { fontSize: '12px', fontWeight: 600, marginBottom: '6px' } }, props.title),
          props.children)
      }

      function Panel() {
        var projectsState = React.useState([])
        var projects = projectsState[0], setProjects = projectsState[1]
        var dirState = React.useState('')
        var dir = dirState[0], setDir = dirState[1]
        var statusState = React.useState(null)
        var status = statusState[0], setStatus = statusState[1]
        var busyState = React.useState('')
        var busy = busyState[0], setBusy = busyState[1]
        var outState = React.useState('')
        var output = outState[0], setOutput = outState[1]
        var errState = React.useState('')
        var error = errState[0], setError = errState[1]
        var nameState = React.useState('')
        var newName = nameState[0], setNewName = nameState[1]
        var actState = React.useState(null)
        var activity = actState[0], setActivity = actState[1]
        var today = new Date().toISOString().slice(0, 10)
        var revState = React.useState('')
        var reviewer = revState[0], setReviewer = revState[1]
        var dateState = React.useState(today)
        var signDate = dateState[0], setSignDate = dateState[1]
        var chgState = React.useState('')
        var changeText = chgState[0], setChangeText = chgState[1]
        var noteState = React.useState('')
        var signNote = noteState[0], setSignNote = noteState[1]
        var scopeState = React.useState(['建模假设', '求解代码', '结果数值', '正文表述', '图表'])
        var scopes = scopeState[0], setScopes = scopeState[1]
        var pvState = React.useState(null)
        var preview = pvState[0], setPreview = pvState[1]

        var t = function (key) {
          return (zh[key] || en[key] || key)
        }

        function loadProjects() {
          return getJson('/projects').then(function (data) {
            setProjects(data.projects || [])
            if (!dir && data.projects && data.projects.length) setDir(data.projects[0].dir)
            if (!data.exists) setError('projectsRoot 不存在：' + data.root)
          })
        }

        React.useEffect(function () {
          loadProjects().catch(function (e) { setError(e.message) })
        }, [])

        React.useEffect(function () {
          if (!dir) return
          getJson('/status?dir=' + encodeURIComponent(dir))
            .then(function (s) { setStatus(s); setError('') })
            .catch(function (e) { setError(e.message) })
          getJson('/activity?dir=' + encodeURIComponent(dir))
            .then(function (a) { setActivity(a) })
            .catch(function () { setActivity(null) })
        }, [dir])

        function run(task) {
          if (!dir || busy) return
          setBusy(task)
          setOutput('')
          postJson('/run', { dir: dir, task: task })
            .then(function (r) {
              setOutput((r.task || task) + ' · ' + (r.ok ? 'OK' : '失败') + '\n\n' + (r.output || '(无输出)'))
              if (r.status) setStatus(r.status)
              setError(r.ok ? '' : '任务失败，看输出')
            })
            .catch(function (e) { setError(e.message) })
            .then(function () { setBusy('') })
        }

        function createWorkspace() {
          var name = (newName || '').trim()
          if (!name || busy) return
          setBusy('new')
          postJson('/new', { name: name })
            .then(function (r) {
              if (!r.ok) {
                if (r.code === 'not-found') throw new Error('新建接口要重启 DSH 后才生效')
                throw new Error(r.message || t('new.exists'))
              }
              setNewName('')
              setDir(r.dir)
              return loadProjects().then(function () { setDir(r.dir) })
            })
            .catch(function (e) { setError(e.message) })
            .then(function () { setBusy('') })
        }

        function submitSignoff() {
          if (busy) return
          if (!(reviewer || '').trim()) { setError('先填审核人姓名'); return }
          var lines = (changeText || '').split('\n').map(function (s) { return s.trim() }).filter(Boolean)
          if (lines.length && lines.length < 5) { setError('改动记录至少要 5 条，现在只有 ' + lines.length + ' 条'); return }
          setBusy('sign')
          postJson('/signoff', {
            dir: dir, reviewer: reviewer.trim(), date: signDate,
            scopes: scopes, note: signNote, changes: lines,
          })
            .then(function (r) {
              if (!r.ok) {
                if (r.code === 'not-found') throw new Error('签字接口要重启 DSH 后才生效')
                throw new Error(r.message || '签字失败')
              }
              if (r.status) setStatus(r.status)
              setChangeText('')
              setOutput('已写入签字（审核人：' + r.reviewer + '，日期：' + r.date + '）'
                + (r.changes ? '\n同时记录了 ' + r.changes + ' 条改动。' : ''))
              setError('')
              return loadActivity()
            })
            .catch(function (e) { setError(e.message) })
            .then(function () { setBusy('') })
        }

        function loadActivity() {
          if (!dir) return Promise.resolve()
          return getJson('/activity?dir=' + encodeURIComponent(dir))
            .then(function (a) { setActivity(a) })
            .catch(function () { /* 过程视图失败不影响主流程 */ })
        }

        function toggleScope(label) {
          var next = scopes.indexOf(label) >= 0
            ? scopes.filter(function (s) { return s !== label })
            : scopes.concat([label])
          setScopes(next)
        }

        // DSH 的外层窗口只放行 https 的 window.open，本地 http 会被静默拒绝。
        // 所以：预览 = 宿主把页面转成 PNG 塞进 <img>；要 PDF 本身 = 调 /open 用系统程序打开。
        function openNative(which) {
          setBusy('open')
          postJson('/open', { dir: dir, which: which })
            .then(function (r) {
              if (!r.ok) {
                if (r.code === 'not-found') throw new Error('原生打开接口要重启 DSH 后才生效，先用「预览」或「下载」')
                throw new Error(r.message || '打开失败')
              }
              setOutput('已用系统默认程序打开：' + r.opened)
              setError('')
            })
            .catch(function (e) { setError(e.message) })
            .then(function () { setBusy('') })
        }

        function downloadPdf(which) {
          var a = document.createElement('a')
          a.href = API + '/pdf?dir=' + encodeURIComponent(dir) + '&which=' + which
          a.download = which === 'ai' ? 'AI-工具使用详情.pdf' : '论文.pdf'
          document.body.appendChild(a)
          a.click()
          a.remove()
        }

        function showPreview(which) {
          var same = preview && preview.which === which
          if (same) { setPreview(null); return }
          setPreview({ which: which, page: 1 })
        }

        var header = h('div', {
          style: { padding: '10px 12px', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid ' + C.line },
        },
        h('div', { style: { fontSize: '13px', fontWeight: 650 } }, t('tab.title')),
        h('span', { style: { fontSize: '10px', color: C.muted, letterSpacing: '0.02em' } }, 'by Rosynb666'),
        h('div', { style: { flex: 1 } }),
        h('button', {
          onClick: function () { loadProjects().catch(function (e) { setError(e.message) }) },
          style: { fontSize: '11px', padding: '3px 8px', borderRadius: '6px', border: '1px solid ' + C.line, background: 'transparent', color: C.fg, cursor: 'pointer' },
        }, t('refresh')))

        var pickerList = projects.length
          ? h('select', {
              value: dir,
              onChange: function (e) { setDir(e.target.value) },
              style: { width: '100%', fontSize: '12px', padding: '5px 6px', borderRadius: '6px', border: '1px solid ' + C.line, background: 'transparent', color: C.fg },
            }, projects.map(function (p) {
              return h('option', { key: p.dir, value: p.dir }, p.name)
            }))
          : h(Tiny, null, t('empty.hint'))

        var inputStyle = {
          flex: 1, minWidth: 0, fontSize: '11.5px', padding: '4px 7px', borderRadius: '6px',
          border: '1px solid ' + C.line, background: 'transparent', color: C.fg,
        }

        var picker = h('div', { style: { padding: '8px 12px' } },
          h('div', { style: { fontSize: '11px', color: C.muted, marginBottom: '4px' } }, t('pick')),
          pickerList,
          h('div', { style: { display: 'flex', gap: '6px', marginTop: '7px' } },
            h('input', {
              value: newName,
              placeholder: t('new.placeholder'),
              onChange: function (e) { setNewName(e.target.value) },
              onKeyDown: function (e) { if (e.key === 'Enter') createWorkspace() },
              style: inputStyle,
            }),
            h('button', {
              onClick: createWorkspace,
              disabled: !!busy,
              style: {
                fontSize: '11.5px', padding: '4px 9px', borderRadius: '6px', cursor: busy ? 'default' : 'pointer',
                border: '1px solid ' + C.line, background: 'transparent', color: busy ? C.muted : C.fg,
              },
            }, busy === 'new' ? t('running') : t('new.button'))))

        var phases = status
          ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '5px', padding: '2px 12px 10px' } },
              status.phases.map(function (p) {
                return h(Dot, { key: p.id, id: p.id, name: p.name, done: p.done, detail: p.detail })
              }))
          : null

        var facts = status
          ? h(Section, { title: t('facts') + ' (' + status.facts.length + ')' },
              status.facts.length
                ? h('div', { style: { maxHeight: '190px', overflowY: 'auto' } },
                    h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: '11.5px' } },
                      h('tbody', null, status.facts.map(function (f) {
                        return h('tr', { key: f.key, title: f.desc + (f.check ? ' | 对照: ' + f.check : '') },
                          h('td', { style: { padding: '3px 4px', color: C.muted, whiteSpace: 'nowrap' } }, f.key),
                          h('td', { style: { padding: '3px 4px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' } },
                            String(f.value) + (f.unit ? ' ' + f.unit : '')),
                          h('td', { style: { padding: '3px 4px', color: C.muted, fontSize: '10.5px', maxWidth: '110px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, f.source || '—'))
                      }))))
                : h(Tiny, null, t('nofacts')))
          : null

        var counts = status
          ? h(Section, { title: t('counts') },
              h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '10px', fontSize: '11.5px' } },
                h('span', null, '\\res ' + status.counts.res + (status.counts.missingRes ? ' (' + status.counts.missingRes + ' 缺)' : '')),
                h('span', null, 'AI 标注 ' + status.counts.aiflag),
                h('span', null, 'TODO ' + status.counts.todo),
                h('span', null, '图 ' + status.counts.figures + ' / 表 ' + status.counts.tables)),
              status.counts.missingKeys && status.counts.missingKeys.length
                ? h(Tiny, null, '缺 key: ' + status.counts.missingKeys.join(', '))
                : null)
          : null

        var miniBtn = function (label, onClick, accent) {
          return h('button', {
            onClick: onClick,
            style: {
              fontSize: '11px', padding: '4px 8px', borderRadius: '6px', cursor: 'pointer',
              border: '1px solid ' + (accent ? C.accent : C.line),
              background: 'transparent', color: accent ? C.accent : C.fg,
            },
          }, label)
        }

        var actions = status
          ? h(Section, { title: '操作' },
              h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
                TASKS.map(function (task) {
                  var isBusy = busy === task.id
                  return h('button', {
                    key: task.id,
                    disabled: !!busy,
                    onClick: function () { run(task.id) },
                    style: {
                      fontSize: '11.5px', padding: '4px 9px', borderRadius: '6px', cursor: busy ? 'default' : 'pointer',
                      border: '1px solid ' + (isBusy ? C.accent : C.line),
                      background: isBusy ? 'rgba(47,111,159,0.10)' : 'transparent',
                      color: busy && !isBusy ? C.muted : C.fg,
                    },
                  }, isBusy ? t('running') : t(task.label))
                })),
              h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' } },
                status.files.pdf ? miniBtn('预览论文', function () { showPreview('paper') }, true) : null,
                status.files.pdf ? miniBtn('系统打开', function () { openNative('paper') }) : null,
                status.files.pdf ? miniBtn('下载论文', function () { downloadPdf('paper') }) : null,
                status.files.aiPdf ? miniBtn('预览 AI 详情', function () { showPreview('ai') }, true) : null,
                status.files.aiPdf ? miniBtn('系统打开', function () { openNative('ai') }) : null,
                status.files.aiPdf ? miniBtn('下载 AI 详情', function () { downloadPdf('ai') }) : null,
                miniBtn('刷新过程', loadActivity)))
          : null

        var consoleNode = output
          ? h(Section, { title: t('output') },
              h('pre', {
                style: {
                  margin: 0, padding: '8px', borderRadius: '6px', background: C.bg,
                  fontSize: '10.5px', lineHeight: 1.45, maxHeight: '220px', overflow: 'auto',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: C.fg,
                },
              }, output))
          : null

        var errNode = error
          ? h('div', { style: { padding: '8px 12px', fontSize: '11.5px', color: C.err } }, error)
          : null

        // ---- 过程视图：写代码 / 写论文 分别到哪一步了 ----
        var mono = { fontSize: '11px', lineHeight: 1.65, fontVariantNumeric: 'tabular-nums' }

        // ---- 页内预览：宿主把 PDF 某一页转成 PNG ----
        var previewNode = preview && status && (preview.which === 'ai' ? status.files.aiPdf : status.files.pdf)
          ? h(Section, { title: (preview.which === 'ai' ? 'AI 工具使用详情' : '论文') + ' · 第 ' + preview.page + ' 页' },
              h('div', { style: { display: 'flex', gap: '6px', marginBottom: '6px' } },
                miniBtn('◀ 上一页', function () {
                  if (preview.page > 1) setPreview({ which: preview.which, page: preview.page - 1 })
                }),
                miniBtn('下一页 ▶', function () {
                  setPreview({ which: preview.which, page: preview.page + 1 })
                }),
                miniBtn('关闭预览', function () { setPreview(null) })),
              h('img', {
                alt: 'PDF 预览',
                src: API + '/preview?dir=' + encodeURIComponent(dir) + '&which=' + preview.which + '&page=' + preview.page,
                style: { width: '100%', border: '1px solid ' + C.line, borderRadius: '4px', background: '#fff' },
                onError: function () { setError('预览取不到这一页（可能超出页数，或宿主还没重启加载 /preview）') },
              }))
          : null

        var processNode = activity
          ? h(Section, { title: '过程' },
              h('div', { style: { fontSize: '10.5px', color: C.muted, marginBottom: '4px' } }, '按文件最后修改时间排的产物时间线'),
              h('div', null, (activity.timeline || []).map(function (t) {
                var d = new Date(t.at)
                var hh = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2)
                return h('div', { key: t.file, style: Object.assign({ display: 'flex', gap: '7px', color: C.muted }, mono) },
                  h('span', { style: { flex: '0 0 40px' } }, hh),
                  h('span', { style: { color: C.fg, flex: 1 } }, t.label),
                  h('span', { style: { fontSize: '10px' } }, t.file))
              })),

              h('div', { style: { fontSize: '10.5px', color: C.muted, margin: '8px 0 2px' } },
                '代码（' + (activity.code || []).length + ' 个文件）'),
              (activity.code || []).map(function (c) {
                return h('div', { key: c.name, style: Object.assign({ display: 'flex', justifyContent: 'space-between' }, mono) },
                  h('span', { style: { color: C.fg } }, c.name),
                  h('span', { style: { color: C.muted } }, c.lines + ' 行 · ' + c.kb + ' KB'))
              }),

              h('div', { style: { fontSize: '10.5px', color: C.muted, margin: '8px 0 2px' } },
                '论文（' + (activity.sections || []).length + ' 节）'),
              (activity.sections || []).map(function (s) {
                var w = Math.min(100, Math.round(s.chars / 12))
                return h('div', { key: s.title, style: { marginBottom: '2px' } },
                  h('div', { style: Object.assign({ display: 'flex', justifyContent: 'space-between' }, mono) },
                    h('span', { style: { color: C.fg } }, s.title),
                    h('span', { style: { color: C.muted } }, s.chars + ' 字')),
                  h('div', { style: { height: '3px', background: 'rgba(0,0,0,0.06)', borderRadius: '2px' } },
                    h('div', { style: { width: w + '%', height: '3px', background: C.accent, borderRadius: '2px' } })))
              }))
          : null

        // ---- 人工签字卡 ----
        var inputStyle2 = {
          fontSize: '11.5px', padding: '4px 7px', borderRadius: '6px',
          border: '1px solid ' + C.line, background: 'transparent', color: C.fg,
        }
        var scopeLabels = ['建模假设', '求解代码', '结果数值', '正文表述', '图表']

        var signNode = status
          ? h(Section, { title: '人工审核签字' },
              h('div', { style: { fontSize: '10.5px', color: C.muted, marginBottom: '6px' } },
                '内容由你填，AI 只负责写文件。不签，P7 不会绿。'),
              h('div', { style: { display: 'flex', gap: '6px' } },
                h('input', {
                  value: reviewer, placeholder: '审核人姓名',
                  onChange: function (e) { setReviewer(e.target.value) },
                  style: Object.assign({ flex: 1, minWidth: 0 }, inputStyle2),
                }),
                h('input', {
                  value: signDate, placeholder: 'YYYY-MM-DD',
                  onChange: function (e) { setSignDate(e.target.value) },
                  style: Object.assign({ width: '92px' }, inputStyle2),
                })),
              h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '9px', margin: '7px 0 0' } },
                scopeLabels.map(function (s) {
                  var on = scopes.indexOf(s) >= 0
                  return h('label', {
                    key: s,
                    style: { fontSize: '11px', color: on ? C.fg : C.muted, cursor: 'pointer' },
                  },
                  h('input', {
                    type: 'checkbox', checked: on, style: { marginRight: '3px' },
                    onChange: function () { toggleScope(s) },
                  }), s)
                })),
              h('textarea', {
                value: changeText, rows: 4,
                placeholder: '改动记录，一行一条（≥5 条）。例：\n[P2] 假设 3 改为海面静止 ← 原假设与模型矛盾\n[P4] 摘要补第三问结果 ← 原稿缺结论数字',
                onChange: function (e) { setChangeText(e.target.value) },
                style: Object.assign({ width: '100%', marginTop: '7px', resize: 'vertical' }, inputStyle2),
              }),
              h('input', {
                value: signNote, placeholder: '审核备注（可空）',
                onChange: function (e) { setSignNote(e.target.value) },
                style: Object.assign({ width: '100%', marginTop: '6px' }, inputStyle2),
              }),
              h('button', {
                onClick: submitSignoff,
                disabled: !!busy,
                style: {
                  marginTop: '7px', fontSize: '11.5px', padding: '5px 12px', borderRadius: '6px',
                  cursor: busy ? 'default' : 'pointer',
                  border: '1px solid ' + C.accent, background: 'rgba(47,111,159,0.10)', color: C.fg,
                },
              }, busy === 'sign' ? '提交中…' : '提交签字'))
          : null

        var skillNode = status && !status.skillReady
          ? h('div', { style: { padding: '8px 12px', fontSize: '11.5px', color: C.warn } }, t('missingSkill'))
          : null

        return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, color: C.fg, overflowY: 'auto' } },
          header, picker, phases, errNode, skillNode, facts, counts, actions, previewNode, processNode, signNode, consoleNode)
      }

      function CumcmIcon(props) {
        var size = (props && props.size) || 16
        return h('svg', {
          width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
          stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
        },
        h('path', { d: 'M4 5.5h6.5v6.5H4z' }),
        h('path', { d: 'M13.5 5.5H20v6.5h-6.5z' }),
        h('path', { d: 'M4 15h6.5v5.5H4z' }),
        h('path', { d: 'M13.5 15H20v5.5h-6.5z' }))
      }

      function apply(ctx) {
        ctx.effect(function () {
          return ctx.locale.register(NS, { zh: zh, en: en })
        }, 'dsh-cumcm: dictionaries')

        ctx.effect(function () {
          var title = function () { return ctx.locale.bind(NS)('tab.title') }
          return ctx.sidebarRightTabs.register({
            id: KIND,
            kind: KIND,
            title: title,
            guide: [{
              id: KIND,
              order: 2500,
              title: function () { return ctx.locale.bind(NS)('tab.guide') },
              description: function () { return ctx.locale.bind(NS)('tab.guideDesc') },
              icon: CumcmIcon,
            }],
          })
        }, 'dsh-cumcm: tab type')

        ctx.effect(function () {
          return ctx.slots.inject('sidebar.right.pane.tab', function () {
            return ctx.slots.register({
              name: 'sidebar.right.pane.tab',
              key: KIND,
              locale: NS,
            }, Panel)
          })
        }, 'dsh-cumcm: pane body')
      }

      exports.name = 'dsh-cumcm'
      exports.inject = ['slots', 'locale', 'sidebarRightTabs']
      exports.apply = apply
      return module.exports
    },
  })
})()
