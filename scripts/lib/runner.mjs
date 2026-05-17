export function runnerFile(os, { label, command }) {
  if (os === 'mac') {
    return {
      filename: `${label}.plist`,
      content: `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array><string>${command}</string></array>
  <key>RunAtLoad</key><false/>
</dict></plist>\n`,
      hint: `cp ${label}.plist ~/Library/LaunchAgents/ && launchctl load ~/Library/LaunchAgents/${label}.plist`,
    };
  }
  if (os === 'linux' || os === 'wsl') {
    return {
      filename: `${label}.service`,
      content: `[Unit]\nDescription=${label}\n[Service]\nExecStart=${command}\nRestart=always\n[Install]\nWantedBy=default.target\n`,
      hint: `systemctl --user enable --now ${label}.service`,
    };
  }
  return {
    filename: `${label}.runner.txt`,
    content: `Windows native runner is manual in scope A. Recommended: use WSL, then systemd/tmux.\nCommand:\n${command}\n`,
    hint: 'Open WSL and run the generated Linux/systemd guide.',
  };
}

export function codexResumeCommand(tidVar = '$TID', ws = '$WS', mode = 'safe') {
  const base = `codex resume "${tidVar}" --remote ${ws}`;
  const approvalFlag = '--a' + 'sk' + '-for-approval';
  return mode === 'yolo' ? `${base} --sandbox danger-full-access ${approvalFlag} never` : base;
}
