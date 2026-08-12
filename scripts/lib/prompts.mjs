const PROMPTS = {
  choose_automation_mode: {
    question: 'Choose the installation strategy — Automatic (auto / 자동) attempts recoverable steps before asking; Manual (manual / 수동) explains each step for you to perform',
    defaultKey: 'automation_mode',
  },
  choose_install_surface: {
    question: 'Choose the install surface — placement copies only the skill file; guided sets up a working bot',
    defaultKey: 'install_surface',
  },
  ask_daemon_guide: {
    question: 'Generate runner files (run.sh, infra-launch.sh, progress config) in the bot working directory',
    defaultKey: 'daemon_guide',
  },
  ask_alias_consent: {
    question: 'Recommended: print one-word start/restart and stop helpers that clean up only the exact previous tmux session; default yes, only explicit no skips',
    defaultKey: 'alias_consent',
  },
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
  confirm_runtime_name: {
    question: 'Choose the short bot runtime name used by tmux, BOT_NAME, and one-word aliases',
    defaultKey: 'session',
  },
  confirm_state_dir: {
    question: 'Confirm the Discord state directory (kept outside the bot working folder)',
    defaultKey: 'state_dir',
  },
  confirm_wiki_path: {
    question: 'Obsidian wiki (vault) path to connect — chat-directed Markdown output saves there and the reply names the saved path. Optional: leave blank to skip and start from a sample wiki later',
    defaultKey: 'wiki_path',
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
  let question = spec.question;
  if (step.verify?.type === 'answer-one-of' && step.verify.choices) {
    question += ` (${String(step.verify.choices).split(',').map(s => s.trim()).join(' / ')})`;
  }
  return { question, defaultValue };
}
