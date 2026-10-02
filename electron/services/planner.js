'use strict';

// 指令室の司令塔。依頼を Claude Code に渡して、どのエージェントに何を任せるかの案を作る。
// Claude Code が使えないとき・利用枠切れのときは、使えるエージェントに順に割り振る簡単な案を返す。
const { spawn } = require('node:child_process');

const TIMEOUT_MS = 3 * 60 * 1000;

function buildPrompt(request, agents) {
  const roster = agents.map((a) => `- ${a.id}: ${a.name}（得意なこと: ${a.strengths}）`).join('\n');
  return [
    'あなたはソフトウェア開発チームの司令塔です。次の依頼を、同時に作業できる独立した作業に分け、エージェントに割り振ってください。',
    'ファイルの編集はしないでください。分担案だけを返してください。',
    '',
    `依頼: ${request}`,
    '',
    '使えるエージェント:',
    roster,
    '',
    '条件:',
    '- 各作業は、ほかの作業とできるだけ同じファイルを触らないように分ける',
    '- エージェント1人につき作業は1つまで。不要なエージェントは使わなくてよい',
    '- 出力は次の形の JSON 配列だけにする（説明文は不要）',
    '[{"agentId": "claude-code", "task": "担当する作業の具体的な内容"}]',
  ].join('\n');
}

// 出力の中から最初の JSON 配列を取り出す
function parsePlan(text, validIds) {
  const match = String(text).match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const list = JSON.parse(match[0]);
    const seen = new Set();
    const plan = list
      .filter((item) => item && validIds.includes(item.agentId) && String(item.task ?? '').trim())
      .filter((item) => !seen.has(item.agentId) && seen.add(item.agentId))
      .map((item) => ({ agentId: item.agentId, task: String(item.task).trim().slice(0, 2000) }));
    return plan.length ? plan : null;
  } catch {
    return null;
  }
}

function fallbackPlan(request, available) {
  const first = available.find((a) => a.kind === 'cli') ?? available[0];
  return first ? [{ agentId: first.id, task: request }] : [];
}

function createPlanner({ agents, quota, git, spawnImpl = spawn }) {
  async function plan(request) {
    const text = String(request ?? '').trim();
    if (!text) throw new Error('依頼の内容が空です');

    const detected = await agents.detect();
    const installedIds = detected.agents.filter((a) => a.installed).map((a) => a.id);
    const available = agents.list().filter((a) => installedIds.includes(a.id) && quota.get(a.id).state !== 'exhausted');
    if (available.length === 0) {
      throw new Error('使えるエージェントがありません（インストールされていないか、利用枠の上限です）');
    }

    const planner = agents.byId('claude-code');
    if (!available.some((a) => a.id === planner.id)) {
      return { source: 'fallback', reason: 'Claude Code が使えないため、簡単な分担にしました', assignments: fallbackPlan(text, available) };
    }

    let cwd;
    try {
      cwd = git.root();
    } catch {
      cwd = undefined;
    }

    const inv = await agents.invocation(planner.id, { mode: 'plan', prompt: buildPrompt(text, available), cwd });
    if (!inv) {
      return { source: 'fallback', reason: 'Claude Code が見つからないため、簡単な分担にしました', assignments: fallbackPlan(text, available) };
    }
    const output = await new Promise((resolve) => {
      const child = spawnImpl(inv.command, inv.args, { cwd, shell: inv.shell, env: inv.env, windowsHide: true });
      let out = '';
      const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
      child.stdout?.on('data', (d) => { out += d; });
      child.stderr?.on('data', (d) => { out += d; });
      child.stdin?.on('error', () => {});
      child.stdin?.end(inv.stdin);
      child.on('error', () => { clearTimeout(timer); resolve(out); });
      child.on('close', () => { clearTimeout(timer); resolve(out); });
    });

    for (const line of output.split(/\r?\n/)) quota.inspectOutput(planner.id, line);
    if (quota.get(planner.id).state === 'exhausted') {
      const rest = available.filter((a) => a.id !== planner.id);
      return {
        source: 'fallback',
        reason: 'Claude Code が利用枠の上限のため、簡単な分担にしました',
        assignments: fallbackPlan(text, rest.length ? rest : available),
      };
    }

    const assignments = parsePlan(output, available.map((a) => a.id));
    if (!assignments) {
      return { source: 'fallback', reason: '分担案を読み取れなかったため、簡単な分担にしました', assignments: fallbackPlan(text, available) };
    }
    return { source: 'claude-code', assignments };
  }

  return { plan };
}

module.exports = { createPlanner, parsePlan, buildPrompt };
