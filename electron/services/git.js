'use strict';

// 作業フォルダの Git 操作。
// エージェントごとに専用ブランチ（oz/<id>）と専用の作業場所（.oz-worktrees/<id>）を持たせ、
// 同時に作業しても互いにぶつからないようにする。最後に元のブランチへまとめる。
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const TIMEOUT_MS = 120000;
const MAX_BUFFER = 20 * 1024 * 1024;
const WORKTREE_DIR = '.oz-worktrees';

function branchName(agentId) {
  const safe = String(agentId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'agent';
  return `oz/${safe}`;
}

function run(cwd, args, { allowFail = false } = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, windowsHide: true }, (err, stdout, stderr) => {
      if (err && !allowFail) {
        reject(new Error(String(stderr || err.message).trim()));
        return;
      }
      resolve({ ok: !err, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

function createGit({ getConfig }) {
  // 作業フォルダ本体（.git）を書き換える操作は1つずつ行う。
  // 分担で3人が同時に始めると、初期化や worktree の追加がぶつかる（index.lock / HEAD のロック）
  let queue = Promise.resolve();
  function exclusive(fn) {
    const result = queue.then(fn, fn);
    queue = result.catch(() => {});
    return result;
  }

  function root() {
    const dir = getConfig()?.workspace;
    if (!dir || !fs.existsSync(dir)) throw new Error('作業フォルダが設定されていません（設定 → 作業フォルダ）');
    return dir;
  }

  async function isRepo(dir = root()) {
    const { ok, stdout } = await run(dir, ['rev-parse', '--is-inside-work-tree'], { allowFail: true });
    return ok && stdout.trim() === 'true';
  }

  async function hasCommit(dir) {
    return (await run(dir, ['rev-parse', '--verify', 'HEAD'], { allowFail: true })).ok;
  }

  // 作業フォルダを Git 管理にする。名前とメール、worktree 置き場の除外設定まで行う
  async function ensureRepoNow({ userName, userEmail } = {}) {
    const dir = root();
    if (!(await isRepo(dir))) {
      await run(dir, ['init']);
      await run(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main'], { allowFail: true });
    }
    const settings = getConfig() ?? {};
    const name = userName ?? settings.gitUserName;
    const email = userEmail ?? settings.gitUserEmail;
    if (name) await run(dir, ['config', 'user.name', name]);
    if (email) await run(dir, ['config', 'user.email', email]);
    if (!(await run(dir, ['config', 'user.name'], { allowFail: true })).stdout.trim()) {
      await run(dir, ['config', 'user.name', 'OZ Assistant']);
    }
    if (!(await run(dir, ['config', 'user.email'], { allowFail: true })).stdout.trim()) {
      await run(dir, ['config', 'user.email', 'oz-assistant@localhost']);
    }

    // worktree 置き場はリポジトリに含めない
    const gitDir = (await run(dir, ['rev-parse', '--git-dir'])).stdout.trim();
    const exclude = path.resolve(dir, gitDir, 'info', 'exclude');
    fs.mkdirSync(path.dirname(exclude), { recursive: true });
    const current = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
    if (!current.split(/\r?\n/).includes(`${WORKTREE_DIR}/`)) {
      fs.appendFileSync(exclude, `${current && !current.endsWith('\n') ? '\n' : ''}${WORKTREE_DIR}/\n`);
    }

    if (!(await hasCommit(dir))) {
      await run(dir, ['commit', '--allow-empty', '-m', 'OZ Assistant: 作業フォルダを初期化']);
    }
    return { path: dir };
  }

  async function currentBranch(dir = root()) {
    const { stdout } = await run(dir, ['rev-parse', '--abbrev-ref', 'HEAD'], { allowFail: true });
    return stdout.trim() || null;
  }

  // まとめ先のブランチ（main / master / 今のブランチ）
  async function baseBranch() {
    const dir = root();
    const configured = getConfig()?.baseBranch;
    for (const name of [configured, 'main', 'master'].filter(Boolean)) {
      if ((await run(dir, ['rev-parse', '--verify', `refs/heads/${name}`], { allowFail: true })).ok) return name;
    }
    const current = await currentBranch(dir);
    return current && current !== 'HEAD' && !current.startsWith('oz/') ? current : 'main';
  }

  function worktreePath(agentId) {
    return path.join(root(), WORKTREE_DIR, String(agentId).replace(/[^a-zA-Z0-9_-]/g, ''));
  }

  const ensureRepo = (options) => exclusive(() => ensureRepoNow(options));

  // エージェント専用の作業場所を用意し、まとめ先の最新を取り込んでから渡す
  const prepareWorktree = (agentId) => exclusive(() => prepareWorktreeNow(agentId));
  async function prepareWorktreeNow(agentId) {
    const dir = root();
    await ensureRepoNow();
    const branch = branchName(agentId);
    const wt = worktreePath(agentId);
    const base = await baseBranch();

    const listed = (await run(dir, ['worktree', 'list', '--porcelain'])).stdout;
    const registered = listed.split('\n').some((line) => line.startsWith('worktree ') && path.resolve(line.slice(9)) === path.resolve(wt));
    if (!registered) {
      if (fs.existsSync(wt)) await run(dir, ['worktree', 'prune'], { allowFail: true });
      const branchExists = (await run(dir, ['rev-parse', '--verify', `refs/heads/${branch}`], { allowFail: true })).ok;
      await run(dir, branchExists ? ['worktree', 'add', wt, branch] : ['worktree', 'add', '-b', branch, wt, base]);
    }

    // 前回の作業が残っていれば保存してから、まとめ先の変更を取り込む
    await commitAll(wt, `${agentId}: 作業開始前の保存`);
    const merged = await run(wt, ['merge', '--no-edit', base], { allowFail: true });
    if (!merged.ok) await run(wt, ['merge', '--abort'], { allowFail: true });
    return { path: wt, branch, base };
  }

  // まとめ先を取り込み、衝突したら衝突したまま残す（解決はエージェントに任せる）。衝突したファイルを返す
  async function startMerge(agentId) {
    const wt = worktreePath(agentId);
    const base = await baseBranch();
    const result = await run(wt, ['merge', '--no-edit', base], { allowFail: true });
    if (result.ok) return [];
    return (await run(wt, ['diff', '--name-only', '--diff-filter=U'], { allowFail: true })).stdout.split('\n').filter(Boolean);
  }

  async function status(dir = root()) {
    if (!(await isRepo(dir))) return { repo: false };
    const { stdout } = await run(dir, ['status', '--porcelain']);
    const files = stdout.split('\n').filter(Boolean).map((line) => ({ state: line.slice(0, 2).trim(), file: line.slice(3) }));
    return { repo: true, branch: await currentBranch(dir), changed: files.length, files };
  }

  async function commitAll(dir, message) {
    await run(dir, ['add', '-A']);
    const staged = await run(dir, ['diff', '--cached', '--numstat'], { allowFail: true });
    if (!staged.stdout.trim()) return { committed: false };
    await run(dir, ['commit', '-m', message || 'OZ Assistant: 変更を保存']);
    const hash = (await run(dir, ['rev-parse', '--short', 'HEAD'])).stdout.trim();
    const files = staged.stdout.split('\n').filter(Boolean).map((line) => {
      const [added, removed, file] = line.split('\t');
      return { file, added: Number(added) || 0, removed: Number(removed) || 0 };
    });
    return { committed: true, hash, files };
  }

  // ブランチ（エージェント）ごとの、まとめ先からの差分
  async function branchDiff(agentId) {
    const dir = root();
    const base = await baseBranch();
    const branch = branchName(agentId);
    if (!(await run(dir, ['rev-parse', '--verify', `refs/heads/${branch}`], { allowFail: true })).ok) {
      return { branch, base, files: [], added: 0, removed: 0, ahead: 0 };
    }
    const { stdout } = await run(dir, ['diff', '--numstat', `${base}...${branch}`], { allowFail: true });
    const files = stdout.split('\n').filter(Boolean).map((line) => {
      const [added, removed, file] = line.split('\t');
      return { file, added: Number(added) || 0, removed: Number(removed) || 0 };
    });
    const ahead = Number((await run(dir, ['rev-list', '--count', `${base}..${branch}`], { allowFail: true })).stdout.trim()) || 0;
    return {
      branch,
      base,
      files,
      ahead,
      added: files.reduce((s, f) => s + f.added, 0),
      removed: files.reduce((s, f) => s + f.removed, 0),
    };
  }

  async function recentCommits(limit = 30) {
    const dir = root();
    if (!(await isRepo(dir))) return [];
    const { stdout } = await run(dir, ['log', `-${limit}`, '--all', '--date-order', '--pretty=format:%h\u0001%D\u0001%ct\u0001%s'], { allowFail: true });
    return stdout.split('\n').filter(Boolean).map((line) => {
      const [hash, refs, time, subject] = line.split('\u0001');
      return { hash, refs, time: Number(time) * 1000, subject };
    });
  }

  // エージェントのブランチを順にまとめ先へ取り込む。衝突したものは取り込まずに報告する
  const mergeAgents = (agentIds) => exclusive(() => mergeAgentsNow(agentIds));
  async function mergeAgentsNow(agentIds) {
    const dir = root();
    const base = await baseBranch();
    await commitAll(dir, 'OZ Assistant: 統合前の保存');
    await run(dir, ['checkout', base]);
    const merged = [];
    const conflicts = [];
    for (const agentId of agentIds) {
      const branch = branchName(agentId);
      if (!(await run(dir, ['rev-parse', '--verify', `refs/heads/${branch}`], { allowFail: true })).ok) continue;
      const result = await run(dir, ['merge', '--no-ff', '--no-edit', '-m', `OZ Assistant: ${agentId} の作業を統合`, branch], { allowFail: true });
      if (result.ok) {
        merged.push(agentId);
      } else {
        const files = (await run(dir, ['diff', '--name-only', '--diff-filter=U'], { allowFail: true })).stdout.split('\n').filter(Boolean);
        await run(dir, ['merge', '--abort'], { allowFail: true });
        conflicts.push({ agentId, branch, files });
      }
    }
    return { base, merged, conflicts };
  }

  return {
    branchName,
    root,
    worktreePath,
    isRepo,
    ensureRepo,
    baseBranch,
    currentBranch,
    prepareWorktree,
    startMerge,
    status,
    commitAll,
    branchDiff,
    recentCommits,
    mergeAgents,
  };
}

module.exports = { createGit, branchName, WORKTREE_DIR };
