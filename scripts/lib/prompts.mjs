const PROMPTS = {
  confirm_repo_root: {
    question: 'Confirm the ThisCodex repository root',
    defaultKey: 'repo_root',
  },
  confirm_workspace_root: {
    question: 'Confirm the workspace or vault root used by this bot',
    defaultKey: 'workspace_root',
  },
  confirm_bot_wd: {
    question: 'Confirm the bot working directory for AGENTS.md, SOUL.md, thread id, and runner files',
    defaultKey: 'cwd',
  },
  confirm_state_dir: {
    question: 'Confirm the Discord state directory outside BOT_WD',
    defaultKey: 'state_dir',
  },
  codex_skill_layer: {
    question: 'Choose the Codex skill layer',
    defaultKey: 'codex_skill_layer',
  },
  codex_marketplace: {
    question: 'Show .codex-plugin marketplace guidance too',
    defaultKey: 'codex_marketplace',
  },
  progress_report_cadence: {
    question: 'Choose proactive progress reporting cadence',
    defaultKey: 'progress_report_cadence',
  },
};

export function promptForStep(step, state = {}) {
  const spec = PROMPTS[step.id] || { question: step.reason || step.id, defaultKey: null };
  const defaultValue = spec.defaultKey ? state.detected?.[spec.defaultKey] || state.answers?.[spec.defaultKey] || '' : '';
  return { question: spec.question, defaultValue };
}
