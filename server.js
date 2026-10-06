const jsonServer = require('json-server')
const { execFile } = require('child_process')
const path = require('path')

const PORT = process.env.PORT || 3900
const server = jsonServer.create()
// File-based router: lowdb writes db.json on every mutation (real disk).
const router = jsonServer.router(path.join(__dirname, 'db.json'))
const middlewares = jsonServer.defaults({ cors: true, readOnly: false })

server.use(middlewares)
server.use('/api/v1', router)

/**
 * Debounced git backup: commits and pushes db.json after mutations so the
 * data survives instance sleeps and redeploys (free tiers have ephemeral
 * disks, the git repository is the durable copy).
 */
let timer = null
function scheduleBackup() {
  if (!process.env.GIT_BACKUP_TOKEN) return
  clearTimeout(timer)
  timer = setTimeout(() => {
    const opts = { cwd: __dirname, env: { ...process.env, GIT_AUTHOR_NAME: 'triaid-api', GIT_AUTHOR_EMAIL: 'api@triaid.dev', GIT_COMMITTER_NAME: 'triaid-api', GIT_COMMITTER_EMAIL: 'api@triaid.dev' } }
    execFile('git', ['add', 'db.json'], opts, () => {
      execFile('git', ['commit', '-m', 'chore(data): persist db state'], opts, () => {
        const url = process.env.RENDER_GIT_BACKUP_URL || `https://x-access-token:${process.env.GIT_BACKUP_TOKEN}@github.com/upc-pre-1ASI0730-2620-8155-SoliDevs/triaid-api.git`
        execFile('git', ['push', url, 'HEAD'], opts, (err) => {
          if (err) console.error('backup push failed:', err.message)
          else console.log('db.json backed up to git at', new Date().toISOString())
        })
      })
    })
  }, 3000)
}
router.db._.id // touch lowdb
const originalWrite = router.db.write.bind(router.db)
router.db.write = () => { scheduleBackup(); return originalWrite() }

server.listen(PORT, () => console.log('Tri-Aid API (json-server) on port', PORT))

/**
 * Diagnostic endpoint: reports runtime git availability and backup config.
 */
server.get('/api/v1/__diag', (req, res) => {
  const fs = require('fs')
  const gitDir = fs.existsSync(path.join(__dirname, '.git'))
  res.json({
    cwd: __dirname,
    isGitRepo: gitDir,
    hasBackupToken: !!process.env.GIT_BACKUP_TOKEN,
    node: process.version
  })
})
