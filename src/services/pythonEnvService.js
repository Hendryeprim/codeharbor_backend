import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const WORKSPACES_ROOT = path.resolve(__dirname, '../../storage/task_workspaces');
if (!fs.existsSync(WORKSPACES_ROOT)) {
  fs.mkdirSync(WORKSPACES_ROOT, { recursive: true });
}

const VENV_CANDIDATES = ['venv', '.venv', 'env'];
const PRESERVED_DIRS = new Set(['venv', '.venv', 'env', '.git', '__pycache__', 'node_modules']);

/**
 * Sanitize IDs to safe directory names
 */
const safeId = (val) => String(val || '').replace(/[^a-zA-Z0-9_-]/g, '_');

/**
 * Get persistent workspace root directory for (userId, taskId)
 */
export const getTaskWorkspaceDir = (userId, taskId) => {
  const dir = path.join(WORKSPACES_ROOT, `${safeId(userId)}_${safeId(taskId)}`);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};

/**
 * Sync project files from frontend into the persistent workspace without overwriting venv/.git
 */
export const syncWorkspaceFiles = (workspaceDir, files = []) => {
  if (!Array.isArray(files) || files.length === 0) return;

  for (const f of files) {
    const rel = String(f.filename || f.path || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    if (!rel || rel.includes('..')) continue;
    const firstSeg = rel.split('/')[0];
    if (PRESERVED_DIRS.has(firstSeg)) continue;

    const fullPath = path.join(workspaceDir, rel);
    const resolved = path.resolve(fullPath);
    if (!resolved.startsWith(path.resolve(workspaceDir))) continue;

    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    if (typeof f.content === 'string') {
      fs.writeFileSync(resolved, f.content, 'utf8');
    }
  }
};

/**
 * Resolve a relative cwd inside workspaceRoot safely (prevents directory escape)
 */
export const resolveSafeCwd = (workspaceDir, currentRelCwd = '', target = '') => {
  const rootResolved = path.resolve(workspaceDir);
  const baseDir = currentRelCwd ? path.resolve(rootResolved, currentRelCwd) : rootResolved;
  const nextDir = target ? path.resolve(baseDir, target) : baseDir;

  if (nextDir !== rootResolved && !nextDir.startsWith(rootResolved + path.sep)) {
    throw new Error('Access denied: Cannot navigate outside the project workspace.');
  }
  if (!fs.existsSync(nextDir) || !fs.statSync(nextDir).isDirectory()) {
    throw new Error(`Directory not found: ${target}`);
  }

  const rel = path.relative(rootResolved, nextDir).replace(/\\/g, '/');
  return { absCwd: nextDir, relCwd: rel };
};

/**
 * Check if a command is available on host
 */
export const isCommandAvailable = (cmd) =>
  new Promise((resolve) => {
    const check = spawn(os.platform() === 'win32' ? `where ${cmd}` : `which ${cmd}`, { shell: true });
    check.on('close', (code) => resolve(code === 0));
    check.on('error', () => resolve(false));
  });

/**
 * Find system Python command
 */
export const getSystemPythonCommand = async () => {
  if (os.platform() !== 'win32') {
    if (await isCommandAvailable('python3')) return 'python3';
    if (await isCommandAvailable('python')) return 'python';
    return null;
  }
  if (await isCommandAvailable('python')) return 'python';
  if (await isCommandAvailable('python3')) return 'python3';
  if (await isCommandAvailable('py')) return 'py';
  return null;
};

/**
 * Detect existing Python virtual environment in workspace (venv/, .venv/, env/)
 */
export const detectVenv = (workspaceDir) => {
  const isWin = os.platform() === 'win32';
  for (const name of VENV_CANDIDATES) {
    const venvDir = path.join(workspaceDir, name);
    if (!fs.existsSync(venvDir) || !fs.statSync(venvDir).isDirectory()) continue;

    const binDir = path.join(venvDir, isWin ? 'Scripts' : 'bin');
    const pythonExe = path.join(binDir, isWin ? 'python.exe' : 'python');
    const python3Exe = path.join(binDir, isWin ? 'python.exe' : 'python3');
    const pipExe = path.join(binDir, isWin ? 'pip.exe' : 'pip');

    const activePython = fs.existsSync(pythonExe)
      ? pythonExe
      : fs.existsSync(python3Exe)
      ? python3Exe
      : null;

    if (activePython) {
      return {
        exists: true,
        name,
        venvDir,
        binDir,
        pythonPath: activePython,
        pipPath: fs.existsSync(pipExe) ? pipExe : null,
      };
    }
  }

  return {
    exists: false,
    name: null,
    venvDir: null,
    binDir: null,
    pythonPath: null,
    pipPath: null,
  };
};

/**
 * Build isolated environment variables with active venv prepended to PATH
 */
export const buildSafeEnv = (workspaceDir, venvInfo = null) => {
  const pathSep = os.platform() === 'win32' ? ';' : ':';
  const basePath = process.env.PATH || '';
  const finalPath = venvInfo?.exists && venvInfo.binDir ? `${venvInfo.binDir}${pathSep}${basePath}` : basePath;

  const env = {
    PATH: finalPath,
    SYSTEMROOT: process.env.SYSTEMROOT || '',
    TEMP: process.env.TEMP || os.tmpdir(),
    TMP: process.env.TMP || os.tmpdir(),
    HOME: workspaceDir,
    USERPROFILE: workspaceDir,
    PYTHONUNBUFFERED: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
  };

  if (venvInfo?.exists && venvInfo.venvDir) {
    env.VIRTUAL_ENV = venvInfo.venvDir;
  }

  return env;
};

/**
 * Run a short internal command safely (used for pip list, venv creation)
 */
const execInternal = (file, args, cwd, env, timeoutMs = 45000) =>
  new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(file, args, { cwd, env, shell: false, windowsHide: true });
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {}
      resolve({ success: false, stdout, stderr: `${stderr}\nCommand timed out.`, exitCode: 124 });
    }, timeoutMs);

    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ success: code === 0, stdout, stderr, exitCode: code ?? 0 });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ success: false, stdout, stderr: err.message, exitCode: 1 });
    });
  });

/**
 * Create a Python virtual environment inside the workspace
 */
export const createVenv = async (workspaceDir, venvName = 'venv') => {
  const safeName = VENV_CANDIDATES.includes(venvName) ? venvName : 'venv';
  const existing = detectVenv(workspaceDir);
  if (existing.exists) {
    return { created: false, venv: existing, message: `Virtual environment '${existing.name}' is already active.` };
  }

  const sysPy = await getSystemPythonCommand();
  if (!sysPy) {
    throw new Error('Python interpreter not found on server. Please install Python 3 to create a virtual environment.');
  }

  const env = buildSafeEnv(workspaceDir, null);
  const res = await execInternal(sysPy, ['-m', 'venv', safeName], workspaceDir, env, 60000);
  if (!res.success) {
    throw new Error(`Failed to create virtual environment: ${res.stderr || res.stdout || 'Unknown error'}`);
  }

  const createdVenv = detectVenv(workspaceDir);
  if (!createdVenv.exists) {
    throw new Error('Virtual environment directory was created, but Python binary was not found inside it.');
  }

  return {
    created: true,
    venv: createdVenv,
    message: `Virtual environment '${createdVenv.name}' created and activated.`,
  };
};

/**
 * Parse requirements.txt lines into structured dependency objects
 */
export const parseRequirementsTxt = (content = '') => {
  const lines = String(content).split(/\r?\n/);
  const deps = [];
  const invalidLines = [];

  for (let i = 0; i < lines.length; i++) {
    let raw = lines[i].trim();
    if (!raw || raw.startsWith('#')) continue;

    // Strip inline comments
    const hashIdx = raw.indexOf(' #');
    if (hashIdx !== -1) raw = raw.slice(0, hashIdx).trim();
    if (!raw) continue;

    // Skip pip option flags (-r, --extra-index-url, etc.)
    if (raw.startsWith('-')) continue;

    // Strip environment markers (; python_version < ...)
    const semiIdx = raw.indexOf(';');
    if (semiIdx !== -1) raw = raw.slice(0, semiIdx).trim();

    // Match package name (with optional [extras]) and optional valid version specifiers
    const match = raw.match(/^([A-Za-z0-9._-]+)(\[[^\]]+\])?(?:\s*((?:===|==|!=|>=|<=|~=|>|<)\s*[A-Za-z0-9.*_+-]+(?:\s*,\s*(?:===|==|!=|>=|<=|~=|>|<)\s*[A-Za-z0-9.*_+-]+)*))?$/);
    if (!match) {
      invalidLines.push({ line: i + 1, raw });
      continue;
    }

    const name = match[1];
    const extras = match[2] || '';
    const constraint = (match[3] || '').trim();

    deps.push({
      name,
      normalizedName: name.toLowerCase().replace(/[-_.]+/g, '-'),
      extras,
      constraint: constraint || 'latest',
      raw,
    });
  }

  return { deps, invalidLines };
};

/**
 * Compare semantic-ish versions numerically for common operators (==, >=, <=, >, <, ~=)
 */
const compareVersions = (a, b) => {
  const pa = String(a).split(/[^0-9]+/).filter(Boolean).map(Number);
  const pb = String(b).split(/[^0-9]+/).filter(Boolean).map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
};

export const satisfiesConstraint = (installedVersion, constraint) => {
  if (!constraint || constraint === 'latest') return true;
  const specs = constraint.split(',').map((s) => s.trim()).filter(Boolean);
  for (const spec of specs) {
    const m = spec.match(/^(==|!=|>=|<=|~=|>|<)\s*(.+)$/);
    if (!m) continue;
    const op = m[1];
    const target = m[2].trim();
    const cmp = compareVersions(installedVersion, target);
    if (op === '==' && cmp !== 0) return false;
    if (op === '!=' && cmp === 0) return false;
    if (op === '>=' && cmp < 0) return false;
    if (op === '<=' && cmp > 0) return false;
    if (op === '>' && cmp <= 0) return false;
    if (op === '<' && cmp >= 0) return false;
    if (op === '~=' && cmp < 0) return false;
  }
  return true;
};

/**
 * Query installed packages inside the active venv (or system python if no venv)
 */
export const getInstalledPackages = async (workspaceDir, venvInfo) => {
  const env = buildSafeEnv(workspaceDir, venvInfo);
  let pyCmd = venvInfo?.exists ? venvInfo.pythonPath : await getSystemPythonCommand();
  if (!pyCmd) {
    return { available: false, error: 'Python interpreter not found.', packages: [] };
  }

  const res = await execInternal(pyCmd, ['-m', 'pip', 'list', '--format=json'], workspaceDir, env, 20000);
  if (!res.success) {
    return {
      available: false,
      error: res.stderr || 'Pip is not installed or unavailable in this environment.',
      packages: [],
    };
  }

  try {
    const parsed = JSON.parse(res.stdout || '[]');
    return {
      available: true,
      error: null,
      packages: Array.isArray(parsed)
        ? parsed.map((p) => ({
            name: p.name,
            normalizedName: String(p.name).toLowerCase().replace(/[-_.]+/g, '-'),
            version: p.version,
          }))
        : [],
    };
  } catch {
    return { available: false, error: 'Failed to parse pip list output.', packages: [] };
  }
};

/**
 * Inspect workspace: venv status, requirements.txt, installed packages, conflicts, and summary
 */
export const getWorkspaceDependencyStatus = async (workspaceDir) => {
  const venv = detectVenv(workspaceDir);
  const reqPath = path.join(workspaceDir, 'requirements.txt');
  const hasRequirements = fs.existsSync(reqPath);
  const rawRequirements = hasRequirements ? fs.readFileSync(reqPath, 'utf8') : '';
  const { deps, invalidLines } = hasRequirements
    ? parseRequirementsTxt(rawRequirements)
    : { deps: [], invalidLines: [] };

  const installedInfo = await getInstalledPackages(workspaceDir, venv);
  const installedMap = new Map(installedInfo.packages.map((p) => [p.normalizedName, p]));

  const dependencies = deps.map((dep) => {
    const found = installedMap.get(dep.normalizedName);
    if (!found) {
      return {
        name: dep.name,
        constraint: dep.constraint,
        installedVersion: null,
        status: 'MISSING',
      };
    }
    const ok = satisfiesConstraint(found.version, dep.constraint);
    return {
      name: dep.name,
      constraint: dep.constraint,
      installedVersion: found.version,
      status: ok ? 'INSTALLED' : 'CONFLICT',
    };
  });

  const summary = {
    totalRequired: dependencies.length,
    installed: dependencies.filter((d) => d.status === 'INSTALLED').length,
    missing: dependencies.filter((d) => d.status === 'MISSING').length,
    conflicts: dependencies.filter((d) => d.status === 'CONFLICT').length,
  };

  const statusPayload = {
    venv: {
      exists: venv.exists,
      name: venv.name,
    },
    pipAvailable: installedInfo.available,
    pipError: installedInfo.error,
    hasRequirements,
    rawRequirements,
    invalidLines,
    dependencies,
    installedPackages: installedInfo.packages,
    summary,
    updatedAt: new Date().toISOString(),
  };

  // Persist snapshot for future reference
  try {
    fs.writeFileSync(path.join(workspaceDir, '.coderharbor_deps.json'), JSON.stringify(statusPayload, null, 2), 'utf8');
  } catch {}

  return statusPayload;
};
