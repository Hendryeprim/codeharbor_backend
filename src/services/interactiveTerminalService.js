import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { detectLanguageFromFilename, executeCodeSnippet } from './codeExecutionService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMP_TERM_DIR = path.resolve(__dirname, '../../storage/temp_terminal_sessions');
if (!fs.existsSync(TEMP_TERM_DIR)) {
  fs.mkdirSync(TEMP_TERM_DIR, { recursive: true });
}

const SESSIONS = new Map();
const MAX_SESSION_MS = 120000; // 2 minutes max per interactive run
const MAX_OUTPUT_CHARS = 250000;

const isCommandAvailable = (cmd) =>
  new Promise((resolve) => {
    const check = spawn(os.platform() === 'win32' ? `where ${cmd}` : `which ${cmd}`, { shell: true });
    check.on('close', (code) => resolve(code === 0));
    check.on('error', () => resolve(false));
  });

const getPythonCommand = async () => {
  if (os.platform() !== 'win32') {
    if (await isCommandAvailable('python3')) return 'python3';
    if (await isCommandAvailable('python')) return 'python';
    return 'python3';
  }
  if (await isCommandAvailable('python')) return 'python';
  if (await isCommandAvailable('python3')) return 'python3';
  return 'python';
};

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
  try {
    fs.rmSync(session.workDir, { recursive: true, force: true });
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

export const startInteractiveSession = async ({
  userId,
  skillSlug = 'python',
  files = [],
  code = '',
  entryFile = 'main.py',
}) => {
  const sessionId = `term_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const workDir = path.join(TEMP_TERM_DIR, sessionId);
  fs.mkdirSync(workDir, { recursive: true });

  const safeEntry = String(entryFile || 'main.py').replace(/\\/g, '/').replace(/^\/+/, '');
  if (safeEntry.includes('..')) {
    fs.rmSync(workDir, { recursive: true, force: true });
    throw new Error('Invalid entry file path.');
  }

  if (Array.isArray(files) && files.length > 0) {
    for (const f of files) {
      if (!f.filename || typeof f.content !== 'string') continue;
      const cleanPath = f.filename.replace(/\\/g, '/').replace(/^\/+/, '');
      if (cleanPath.includes('..')) continue;
      const fullPath = path.join(workDir, cleanPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, f.content, 'utf8');
    }
  } else {
    const fullPath = path.join(workDir, safeEntry);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, code || '', 'utf8');
  }

  const detected = detectLanguageFromFilename(safeEntry, skillSlug);
  const langLabel =
    detected === 'javascript' ? 'JavaScript' : detected === 'java' ? 'Java' : detected === 'sql' ? 'SQL' : 'Python';

  // SQL is non-interactive: run immediately and emit output on stream attach
  if (detected === 'sql') {
    const targetFile = Array.isArray(files)
      ? files.find((f) => (f.filename || '').replace(/\\/g, '/') === safeEntry)
      : null;
    const sqlRes = await executeCodeSnippet({ language: 'sql', code: targetFile?.content ?? code });
    const session = {
      id: sessionId,
      userId,
      workDir,
      child: null,
      res: null,
      buffer: [],
      closed: true,
      detectedLanguage: 'SQL',
      startTime: Date.now(),
    };
    if (sqlRes.stdout) emitEvent(session, 'stdout', { text: sqlRes.stdout });
    if (sqlRes.stderr) emitEvent(session, 'stderr', { text: sqlRes.stderr });
    emitEvent(session, 'exit', { exitCode: sqlRes.exitCode ?? 0, executionTimeMs: sqlRes.executionTimeMs ?? 0 });
    SESSIONS.set(sessionId, session);
    setTimeout(() => cleanupSession(sessionId), 10000);
    return { sessionId, detectedLanguage: 'SQL' };
  }

  let command = '';
  if (detected === 'javascript') {
    command = `node "${safeEntry}"`;
  } else if (detected === 'java') {
    const hasJava = await isCommandAvailable('javac');
    if (!hasJava) {
      const targetFile = Array.isArray(files)
        ? files.find((f) => (f.filename || '').replace(/\\/g, '/') === safeEntry)
        : null;
      const javaRes = await executeCodeSnippet({ language: 'java', code: targetFile?.content ?? code });
      const session = {
        id: sessionId,
        userId,
        workDir,
        child: null,
        res: null,
        buffer: [],
        closed: true,
        detectedLanguage: 'Java',
        startTime: Date.now(),
      };
      if (javaRes.stdout) emitEvent(session, 'stdout', { text: javaRes.stdout });
      if (javaRes.stderr) emitEvent(session, 'stderr', { text: javaRes.stderr });
      emitEvent(session, 'exit', { exitCode: javaRes.exitCode ?? 0, executionTimeMs: javaRes.executionTimeMs ?? 0 });
      SESSIONS.set(sessionId, session);
      setTimeout(() => cleanupSession(sessionId), 10000);
      return { sessionId, detectedLanguage: 'Java' };
    }
    const entryDir = path.dirname(safeEntry);
    const className = path.basename(safeEntry, '.java');
    const cp = entryDir && entryDir !== '.' ? `-cp "${entryDir}"` : '';
    command = `javac "${safeEntry}" && java ${cp} ${className}`.trim();
  } else {
    const pyCmd = await getPythonCommand();
    command = `${pyCmd} -u "${safeEntry}"`;
  }

  const safeEnv = {
    PATH: process.env.PATH || '',
    SYSTEMROOT: process.env.SYSTEMROOT || '',
    TEMP: process.env.TEMP || os.tmpdir(),
    TMP: process.env.TMP || os.tmpdir(),
    HOME: workDir,
    USERPROFILE: workDir,
    PYTHONUNBUFFERED: '1',
    PYTHONDONTWRITEBYTECODE: '1',
  };

  const child = spawn(command, [], {
    cwd: workDir,
    env: safeEnv,
    shell: true,
    windowsHide: true,
  });

  const session = {
    id: sessionId,
    userId,
    workDir,
    child,
    res: null,
    buffer: [],
    closed: false,
    outputLen: 0,
    detectedLanguage: langLabel,
    startTime: Date.now(),
    timer: null,
  };

  session.timer = setTimeout(() => {
    if (!session.closed) {
      emitEvent(session, 'stderr', { text: '\n[Timeout Error]: Interactive session exceeded 2 minutes limit. Terminated.\n' });
      emitEvent(session, 'exit', { exitCode: 124, executionTimeMs: Date.now() - session.startTime });
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
    emitEvent(session, 'exit', {
      exitCode: code ?? 0,
      executionTimeMs: Date.now() - session.startTime,
    });
    if (session.res && !session.res.writableEnded) {
      session.res.end();
    }
    setTimeout(() => cleanupSession(sessionId), 5000);
  });

  child.on('error', (err) => {
    if (session.closed) return;
    session.closed = true;
    emitEvent(session, 'stderr', { text: `\nProcess error: ${err.message}\n` });
    emitEvent(session, 'exit', { exitCode: 1, executionTimeMs: Date.now() - session.startTime });
    if (session.res && !session.res.writableEnded) {
      session.res.end();
    }
    setTimeout(() => cleanupSession(sessionId), 5000);
  });

  SESSIONS.set(sessionId, session);
  return { sessionId, detectedLanguage: langLabel };
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

  // Flush any buffered output emitted before stream attached
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
    emitEvent(session, 'exit', { exitCode: 130, executionTimeMs: Date.now() - session.startTime });
    session.closed = true;
    if (session.res && !session.res.writableEnded) session.res.end();
  }
  cleanupSession(sessionId);
  return true;
};
