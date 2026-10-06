const jsonServer = require('json-server')
const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')

const PORT = process.env.PORT || 3900
const server = jsonServer.create()
const middlewares = jsonServer.defaults({ cors: true })

server.use(middlewares)

/**
 * Diagnostic endpoint: reports runtime git availability and backup config.
 */
server.get('/api/v1/__diag', (req, res) => {
  res.json({
    cwd: __dirname,
    isGitRepo: fs.existsSync(path.join(__dirname, '.git')),
    hasBackupToken: !!process.env.GIT_BACKUP_TOKEN,
    node: process.version
  })
})

server.get('/api/v1/__backup', async (req, res) => {
  const opts = { cwd: __dirname, env: { ...process.env, GIT_AUTHOR_NAME: 'triaid-api', GIT_AUTHOR_EMAIL: 'api@triaid.dev', GIT_COMMITTER_NAME: 'triaid-api', GIT_COMMITTER_EMAIL: 'api@triaid.dev' } }
  try { fs.unlinkSync(path.join(__dirname, '.git', 'index.lock')) } catch (e) {}
  const run = (cmd, args) => new Promise((r) => execFile(cmd, args, opts, (err, so, se) => r({ cmd: [cmd].concat(args).join(' '), err: err ? (err.message + ' | ' + se) : null, out: so })))
  const steps = []
  steps.push(await run('git', ['add', 'db.json']))
  steps.push(await run('git', ['commit', '-m', 'chore(data): persist db state']))
  steps.push(await run('git', ['push', 'https://x-access-token:' + process.env.GIT_BACKUP_TOKEN + '@github.com/upc-pre-1ASI0730-2620-8155-SoliDevs/triaid-api.git', 'HEAD:refs/heads/main']))
  res.json(steps)
})

// File-based router: lowdb writes db.json on every mutation (real disk).
const router = jsonServer.router(path.join(__dirname, 'db.json'))
server.use('/api/v1', router)

/**
 * Debounced git backup: commits and pushes db.json after mutations so the
 * data survives instance sleeps and redeploys (ephemeral disks keep only
 * the repository copy durable).
 */
let timer = null
function scheduleBackup() {
  if (!process.env.GIT_BACKUP_TOKEN) return
  clearTimeout(timer)
  timer = setTimeout(() => {
    const opts = { cwd: __dirname, env: { ...process.env, GIT_AUTHOR_NAME: 'triaid-api', GIT_AUTHOR_EMAIL: 'api@triaid.dev', GIT_COMMITTER_NAME: 'triaid-api', GIT_COMMITTER_EMAIL: 'api@triaid.dev' } }
    try { fs.unlinkSync(path.join(__dirname, '.git', 'index.lock')) } catch (e) {}
    const runStep = (cmd, args) => new Promise((r) => execFile(cmd, args, opts, (err, so, se) => r({ err, so, se })))
    ;(async () => {
      await runStep('git', ['add', 'db.json'])
      await runStep('git', ['commit', '-m', 'chore(data): persist db state'])
      const url = `https://x-access-token:${process.env.GIT_BACKUP_TOKEN}@github.com/upc-pre-1ASI0730-2620-8155-SoliDevs/triaid-api.git`
      const push = await runStep('git', ['push', url, 'HEAD:refs/heads/main'])
      if (push.err) console.error('backup push failed:', push.se || push.err.message)
      else console.log('db.json backed up at', new Date().toISOString())
    })()
  }, 3000)
}
const originalWrite = router.db.write.bind(router.db)
router.db.write = () => { scheduleBackup(); return originalWrite() }

server.listen(PORT, () => console.log('Tri-Aid API (json-server) on port', PORT))
