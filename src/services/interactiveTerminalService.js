import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { detectLanguageFromFilename, executeCodeSnippet } from './codeExecutionService.js';
import {
  getTaskWorkspaceDir,
  syncWorkspaceFiles,
  resolveSafeCwd,
  detectVenv,
  buildSafeEnv,
  getSystemPythonCommand,
} from './pythonEnvService.js';

const SESSIONS = new Map();
const WORKSPACE_CWDS = new Map(); // key: `${userId}_${taskId}` -> relative cwd string
const MAX_SESSION_MS = 180000; // 3 minutes max per interactive/pip run
const MAX_OUTPUT_CHARS = 350000;

const isCommandAvailable = (cmd) =>
  new Promise((resolve) => {
    const check = spawn(os.platform() === 'win32' ? `where ${cmd}` : `which ${cmd}`, { shell: true });
    check.on('close', (code) => resolve(code === 0));
    check.on('error', () => resolve(false));
  });

const cleanupSession = (sessionId) => {
  const session = SESSIONS.get(sessionId);
  if (!session) return;
  if (session.timer) clearTimeout(session.timer);
  try {
    if (session.child && !session.closed) {
      if (os.platform() === 'win32') {
        spawn(`taskkill /pid ${session.child.pid} /T /F`, { shell: true });
      } else {
        session.child.kill('SIGKILL');
      }
    }
  } catch {}
  SESSIONS.delete(sessionId);
};

const emitEvent = (session, eventName, payload) => {
  const dataStr = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  if (session.res && !session.res.writableEnded) {
    session.res.write(dataStr);
  } else {
    session.buffer.push(dataStr);
  }
};

const isDangerousCommand = (cmd) => {
  const lower = cmd.toLowerCase();
  const blockedPatterns = [
    /\b(printenv|export\s+-p)\b/,
    /\b(rm\s+-rf\s+\/|mkfs|shutdown|reboot|halt|poweroff|dd\s+if=)\b/,
    /\b(cat|type|more|less)\s+.*\.env\b/,
    /\.\.[\/\\]\.\.[\/\\]/,
  ];
  return blockedPatterns.some((re) => re.test(lower));
};

const createImmediateSession = ({ userId, workspaceDir, relCwd, venv, detectedLanguage, stdout = '', stderr = '', exitCode = 0, refreshDeps = false }) => {
  const sessionId = `term_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const reqPath = path.join(workspaceDir, 'requirements.txt');
  const requirementsContent = refreshDeps && fs.existsSync(reqPath) ? fs.readFileSync(reqPath, 'utf8') : undefined;

  const session = {
    id: sessionId,
    userId,
    workspaceDir,
    child: null,
    res: null,
    buffer: [],
    closed: true,
    detectedLanguage,
    startTime: Date.now(),
  };

  if (stdout) emitEvent(session, 'stdout', { text: stdout });
  if (stderr) emitEvent(session, 'stderr', { text: stderr });
  emitEvent(session, 'exit', {
    exitCode,
    executionTimeMs: 0,
    cwd: relCwd,
    venv: { exists: venv.exists, name: venv.name },
    refreshDeps,
    requirementsContent,
  });

  SESSIONS.set(sessionId, session);
  setTimeout(() => SESSIONS.delete(sessionId), 15000);
  return {
    sessionId,
    detectedLanguage,
    cwd: relCwd,
    venv: { exists: venv.exists, name: venv.name },
  };
};

export const startInteractiveSession = async ({
  userId,
  taskId = 'default',
  skillSlug = 'python',
  files = [],
  code = '',
  entryFile = 'main.py',
  rawCommand = '',
}) => {
  const workspaceDir = getTaskWorkspaceDir(userId, taskId);
  syncWorkspaceFiles(workspaceDir, files);

  const cwdKey = `${userId}_${taskId}`;
  let relCwd = WORKSPACE_CWDS.get(cwdKey) || '';
  let absCwd = workspaceDir;
  try {
    const resolved = resolveSafeCwd(workspaceDir, relCwd, '');
    absCwd = resolved.absCwd;
    relCwd = resolved.relCwd;
  } catch {
    relCwd = '';
    absCwd = workspaceDir;
    WORKSPACE_CWDS.set(cwdKey, '');
  }

  let venv = detectVenv(workspaceDir);
  const trimmedCmd = String(rawCommand || '').trim();

  // 1. Handle built-in directory navigation & workspace-safe commands
  if (trimmedCmd) {
    if (isDangerousCommand(trimmedCmd)) {
      return createImmediateSession({
        userId,
        workspaceDir,
        relCwd,
        venv,
        detectedLanguage: 'Shell',
        stderr: 'Security Error: Command blocked to protect host environment and secrets.\n',
        exitCode: 1,
      });
    }

    if (/^pwd$/i.test(trimmedCmd)) {
      return createImmediateSession({
        userId,
        workspaceDir,
        relCwd,
        venv,
        detectedLanguage: 'Shell',
        stdout: `/workspace${relCwd ? '/' + relCwd : ''}\n`,
        exitCode: 0,
      });
    }

    const cdMatch = trimmedCmd.match(/^cd(?:\s+(.*))?$/i);
    if (cdMatch) {
      const target = (cdMatch[1] || '').trim().replace(/^["']|["']$/g, '');
      try {
        const next = target === '~' || target === '/' || !target
          ? { absCwd: workspaceDir, relCwd: '' }
          : resolveSafeCwd(workspaceDir, relCwd, target);
        WORKSPACE_CWDS.set(cwdKey, next.relCwd);
        return createImmediateSession({
          userId,
          workspaceDir,
          relCwd: next.relCwd,
          venv,
          detectedLanguage: 'Shell',
          stdout: '',
          exitCode: 0,
        });
      } catch (err) {
        return createImmediateSession({
          userId,
          workspaceDir,
          relCwd,
          venv,
          detectedLanguage: 'Shell',
          stderr: `${err.message}\n`,
          exitCode: 1,
        });
      }
    }
  }

  // Determine whether this is a shell command (pip, git, ls, python -m venv, etc.) or a file run
  let command = '';
  let detectedLanguage = 'Python';
  let isEnvMutation = false;

  if (trimmedCmd) {
    const lower = trimmedCmd.toLowerCase();
    isEnvMutation = /\b(pip|pip3|venv|virtualenv|requirements\.txt)\b/.test(lower);

    if (lower.startsWith('pip ') || lower === 'pip' || lower.startsWith('pip3 ') || lower === 'pip3') {
      detectedLanguage = 'Python';
      const pipSub = trimmedCmd.replace(/^pip3?\s*/i, '');
      if (venv.exists && venv.pythonPath) {
        command = `"${venv.pythonPath}" -m pip ${pipSub}`;
      } else {
        const sysPy = await getSystemPythonCommand();
        if (!sysPy) {
          return createImmediateSession({
            userId,
            workspaceDir,
            relCwd,
            venv,
            detectedLanguage: 'Python',
            stderr: 'Error: Python interpreter not found on server. Cannot execute pip.\n',
            exitCode: 1,
          });
        }
        command = `${sysPy} -m pip ${pipSub}`;
      }
    } else if (/^(python|python3|py)\s+-m\s+venv\b/i.test(trimmedCmd)) {
      detectedLanguage = 'Python';
      isEnvMutation = true;
      const sysPy = await getSystemPythonCommand();
      if (!sysPy) {
        return createImmediateSession({
          userId,
          workspaceDir,
          relCwd,
          venv,
          detectedLanguage: 'Python',
          stderr: 'Error: Python interpreter not found on server.\n',
          exitCode: 1,
        });
      }
      command = trimmedCmd.replace(/^(python|python3|py)\b/i, sysPy);
    } else if (/^(python|python3|py)\s+/i.test(trimmedCmd)) {
      detectedLanguage = 'Python';
      const rest = trimmedCmd.replace(/^(python|python3|py)\s+/i, '');
      const pyBin = venv.exists && venv.pythonPath ? `"${venv.pythonPath}"` : (await getSystemPythonCommand()) || 'python3';
      command = `${pyBin} -u ${rest}`;
    } else if (os.platform() === 'win32' && /^ls(\s+.*)?$/i.test(trimmedCmd)) {
      detectedLanguage = 'Shell';
      command = trimmedCmd.replace(/^ls\b/i, 'dir');
    } else {
      detectedLanguage = 'Shell';
      command = trimmedCmd;
    }
  } else {
    // Direct file run (Run Code button or filename typed)
    const safeEntry = String(entryFile || 'main.py').replace(/\\/g, '/').replace(/^\/+/, '');
    if (safeEntry.includes('..')) {
      throw new Error('Invalid entry file path.');
    }

    if (!Array.isArray(files) || files.length === 0) {
      const fullPath = path.join(workspaceDir, safeEntry);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, code || '', 'utf8');
    }

    const detected = detectLanguageFromFilename(safeEntry, skillSlug);
    detectedLanguage =
      detected === 'javascript' ? 'JavaScript' : detected === 'java' ? 'Java' : detected === 'sql' ? 'SQL' : 'Python';

    if (detected === 'sql') {
      const targetFile = Array.isArray(files)
        ? files.find((f) => (f.filename || f.path || '').replace(/\\/g, '/') === safeEntry)
        : null;
      const sqlRes = await executeCodeSnippet({ language: 'sql', code: targetFile?.content ?? code });
      return createImmediateSession({
        userId,
        workspaceDir,
        relCwd,
        venv,
        detectedLanguage: 'SQL',
        stdout: sqlRes.stdout,
        stderr: sqlRes.stderr,
        exitCode: sqlRes.exitCode ?? 0,
      });
    }

    if (detected === 'javascript') {
      command = `node "${safeEntry}"`;
    } else if (detected === 'java') {
      const hasJava = await isCommandAvailable('javac');
      if (!hasJava) {
        const targetFile = Array.isArray(files)
          ? files.find((f) => (f.filename || f.path || '').replace(/\\/g, '/') === safeEntry)
          : null;
        const javaRes = await executeCodeSnippet({ language: 'java', code: targetFile?.content ?? code });
        return createImmediateSession({
          userId,
          workspaceDir,
          relCwd,
          venv,
          detectedLanguage: 'Java',
          stdout: javaRes.stdout,
          stderr: javaRes.stderr,
          exitCode: javaRes.exitCode ?? 0,
        });
      }
      const entryDir = path.dirname(safeEntry);
      const className = path.basename(safeEntry, '.java');
      const cp = entryDir && entryDir !== '.' ? `-cp "${entryDir}"` : '';
      command = `javac "${safeEntry}" && java ${cp} ${className}`.trim();
    } else {
      const pyBin = venv.exists && venv.pythonPath ? `"${venv.pythonPath}"` : (await getSystemPythonCommand()) || 'python3';
      command = `${pyBin} -u "${safeEntry}"`;
    }
  }

  const safeEnv = buildSafeEnv(workspaceDir, venv);
  const sessionId = `term_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  const child = spawn(command, [], {
    cwd: absCwd,
    env: safeEnv,
    shell: true,
    windowsHide: true,
  });

  const session = {
    id: sessionId,
    userId,
    workspaceDir,
    relCwd,
    child,
    res: null,
    buffer: [],
    closed: false,
    outputLen: 0,
    detectedLanguage,
    isEnvMutation,
    startTime: Date.now(),
    timer: null,
  };

  session.timer = setTimeout(() => {
    if (!session.closed) {
      emitEvent(session, 'stderr', { text: '\n[Timeout Error]: Process exceeded 3 minutes limit. Terminated.\n' });
      emitEvent(session, 'exit', {
        exitCode: 124,
        executionTimeMs: Date.now() - session.startTime,
        cwd: relCwd,
        venv: { exists: venv.exists, name: venv.name },
        refreshDeps: isEnvMutation,
      });
      session.closed = true;
      if (session.res && !session.res.writableEnded) session.res.end();
      cleanupSession(sessionId);
    }
  }, MAX_SESSION_MS);

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    session.outputLen += text.length;
    if (session.outputLen <= MAX_OUTPUT_CHARS) {
      emitEvent(session, 'stdout', { text });
    }
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    session.outputLen += text.length;
    if (session.outputLen <= MAX_OUTPUT_CHARS) {
      emitEvent(session, 'stderr', { text });
    }
  });

  child.on('close', (code) => {
    if (session.closed) return;
    session.closed = true;
    const latestVenv = detectVenv(workspaceDir);
    const reqPath = path.join(workspaceDir, 'requirements.txt');
    const requirementsContent = isEnvMutation && fs.existsSync(reqPath) ? fs.readFileSync(reqPath, 'utf8') : undefined;

    emitEvent(session, 'exit', {
      exitCode: code ?? 0,
      executionTimeMs: Date.now() - session.startTime,
      cwd: relCwd,
      venv: { exists: latestVenv.exists, name: latestVenv.name },
      refreshDeps: isEnvMutation,
      requirementsContent,
    });
    if (session.res && !session.res.writableEnded) {
      session.res.end();
    }
    setTimeout(() => SESSIONS.delete(sessionId), 5000);
  });

  child.on('error', (err) => {
    if (session.closed) return;
    session.closed = true;
    emitEvent(session, 'stderr', { text: `\nProcess error: ${err.message}\n` });
    emitEvent(session, 'exit', {
      exitCode: 1,
      executionTimeMs: Date.now() - session.startTime,
      cwd: relCwd,
      venv: { exists: venv.exists, name: venv.name },
    });
    if (session.res && !session.res.writableEnded) {
      session.res.end();
    }
    setTimeout(() => SESSIONS.delete(sessionId), 5000);
  });

  SESSIONS.set(sessionId, session);
  return {
    sessionId,
    detectedLanguage,
    cwd: relCwd,
    venv: { exists: venv.exists, name: venv.name },
  };
};

export const attachTerminalStream = (sessionId, userId, res) => {
  const session = SESSIONS.get(sessionId);
  if (!session || session.userId !== userId) {
    return false;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  session.res = res;

  while (session.buffer.length > 0) {
    res.write(session.buffer.shift());
  }

  if (session.closed) {
    res.end();
    return true;
  }

  res.on('close', () => {
    if (!session.closed) {
      cleanupSession(sessionId);
    }
  });

  return true;
};

export const sendTerminalInput = (sessionId, userId, input) => {
  const session = SESSIONS.get(sessionId);
  if (!session || session.userId !== userId || session.closed || !session.child?.stdin) {
    return false;
  }
  try {
    session.child.stdin.write(`${input ?? ''}\n`);
    return true;
  } catch {
    return false;
  }
};

export const stopInteractiveSession = (sessionId, userId) => {
  const session = SESSIONS.get(sessionId);
  if (!session || session.userId !== userId) {
    return false;
  }
  if (!session.closed) {
    emitEvent(session, 'stderr', { text: '\n^C (Process terminated by user)\n' });
    emitEvent(session, 'exit', {
      exitCode: 130,
      executionTimeMs: Date.now() - session.startTime,
      cwd: session.relCwd || '',
    });
    session.closed = true;
    if (session.res && !session.res.writableEnded) session.res.end();
  }
  cleanupSession(sessionId);
  return true;
};
