// Claude Code Subscription Provider — wrapper installer (spec §11 `wrapper install`).
//
// Clones the upstream `claude-code-openai-wrapper` at a PINNED SHA (vendored
// dependency with a recorded SHA — spec §12 trust note), creates a Python venv,
// and installs its dependencies. CommonJS; the command runner is injectable so
// the orchestration is testable and so main.js can stream progress to the UI.
//
// We launch the wrapper via its venv Python (poetry is not required): the FastAPI
// app object is `src.main:app`, served directly with uvicorn — which bypasses the
// upstream `run_server()` interactive API-key prompt (it would hang a child proc).

const path = require('path')
const fsSync = require('fs')
const fs = require('fs/promises')
const childProcess = require('child_process')

const REPO_URL = 'https://github.com/RichardAtCT/claude-code-openai-wrapper'
// Pinned, reviewed upstream commit (v2.3.0 tree). Bump deliberately, never float.
const PINNED_SHA = '74951748c5085daa60c61e13db72a9ae1b81b208'
const DIR_NAME = 'claude-code-openai-wrapper'
const META_FILE = '.oam-install.json'

function getInstallDir(userDataDir) {
  return path.join(userDataDir, DIR_NAME)
}
function getVenvDir(installDir) {
  return path.join(installDir, '.venv')
}
// The venv interpreter — Scripts/python.exe on Windows, bin/python elsewhere.
function getVenvPython(installDir) {
  return process.platform === 'win32'
    ? path.join(getVenvDir(installDir), 'Scripts', 'python.exe')
    : path.join(getVenvDir(installDir), 'bin', 'python')
}

function pathExistsSync(p) {
  try {
    fsSync.accessSync(p)
    return true
  } catch {
    return false
  }
}

// Installed = repo cloned + venv interpreter present + our meta sentinel written.
function isInstalled(installDir) {
  return (
    pathExistsSync(path.join(installDir, '.git')) &&
    pathExistsSync(getVenvPython(installDir)) &&
    pathExistsSync(path.join(installDir, META_FILE))
  )
}

async function readMeta(installDir) {
  try {
    return JSON.parse(await fs.readFile(path.join(installDir, META_FILE), 'utf8'))
  } catch {
    return null
  }
}

// Run a command, streaming combined stdout/stderr to onProgress. Resolves on
// exit 0; rejects otherwise. Injectable via deps.run for tests.
function run(cmd, args, opts, onProgress) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(cmd, args, { windowsHide: true, ...opts })
    const emit = (s) => onProgress && onProgress(String(s))
    child.stdout?.on('data', emit)
    child.stderr?.on('data', emit)
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`))))
  })
}

// Full install pipeline. `opts`: { onProgress, pythonExe, gitExe }. `deps.run`
// overrides the command runner for tests.
async function install(installDir, opts = {}, deps = {}) {
  const runner = deps.run || run
  const pythonExe = opts.pythonExe || 'python'
  const gitExe = opts.gitExe || 'git'
  const onProgress = opts.onProgress
  const log = (m) => onProgress && onProgress(m.endsWith('\n') ? m : m + '\n')

  // 1. clone (skip if already present)
  if (!pathExistsSync(path.join(installDir, '.git'))) {
    await fs.mkdir(path.dirname(installDir), { recursive: true })
    log(`Cloning ${REPO_URL} …`)
    await runner(gitExe, ['clone', REPO_URL, installDir], {}, onProgress)
  } else {
    log('Repository already present — reusing.')
  }

  // 2. pin to the reviewed SHA
  log(`Checking out ${PINNED_SHA.slice(0, 10)} …`)
  await runner(gitExe, ['-C', installDir, 'fetch', '--quiet', 'origin', PINNED_SHA], {}, onProgress).catch(() => {})
  await runner(gitExe, ['-C', installDir, 'checkout', '--quiet', PINNED_SHA], {}, onProgress)

  // 3. virtualenv
  if (!pathExistsSync(getVenvPython(installDir))) {
    log('Creating Python virtual environment …')
    await runner(pythonExe, ['-m', 'venv', getVenvDir(installDir)], { cwd: installDir }, onProgress)
  } else {
    log('Virtual environment already present — reusing.')
  }
  const venvPy = getVenvPython(installDir)

  // 4. dependencies (pip reads poetry-core build metadata from pyproject.toml)
  log('Upgrading pip …')
  await runner(venvPy, ['-m', 'pip', 'install', '--upgrade', 'pip'], { cwd: installDir }, onProgress)
  log('Installing wrapper dependencies — this can take a few minutes …')
  await runner(venvPy, ['-m', 'pip', 'install', '.'], { cwd: installDir }, onProgress)

  // 5. record what we installed
  const meta = {
    sha: PINNED_SHA,
    repo: REPO_URL,
    installedAt: new Date().toISOString(),
    python: venvPy,
  }
  await fs.writeFile(path.join(installDir, META_FILE), JSON.stringify(meta, null, 2), 'utf8')
  log('Wrapper installed.')
  return meta
}

module.exports = {
  REPO_URL,
  PINNED_SHA,
  DIR_NAME,
  getInstallDir,
  getVenvDir,
  getVenvPython,
  isInstalled,
  readMeta,
  install,
  run,
}
