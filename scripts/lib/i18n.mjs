export const MESSAGES = {
  toneAsk: {
    plain: '설명을 어떻게 받을까요? [1] 쉬운 설명(권장) [2] 개발자용 설명',
    dev: 'Output register? [1] plain [2] dev',
  },
  placement: {
    plain: 'Codex 설치 성공은 npm 폴더가 아니라 Codex가 스킬을 찾는 폴더에 들어갔는지로 판단합니다.',
    dev: 'Success criterion = Codex skill-scan visibility, not npm install location.',
  },
  auth: {
    plain: 'Codex 로그인 정보는 보통 ~/.codex/auth.json 에 있습니다. 없으면 설치 후 smoke 테스트가 제한됩니다.',
    dev: 'Codex auth probe: ~/.codex/auth.json or $CODEX_HOME/auth.json.',
  },
  marketplace: {
    plain: '.codex-plugin 은 보조 경로입니다. 현재는 marketplace 안내만 하고 기본 설치는 ~/.agents/skills 로 합니다.',
    dev: '.codex-plugin is auxiliary; primary loose install = ~/.agents/skills.',
  },
  topology: {
    plain: '단일 봇도 내부 작업 분해를 할 수 있습니다. 멀티 봇은 장기 정체성, 토큰, 작업 폴더, 상태 폴더를 나누는 선택입니다.',
    dev: 'Subagents and multi-bot topology are orthogonal.',
  },
  runner: {
    plain: '데몬은 자동으로 시작하지 않습니다. 대신 OS별 실행 파일과 실행 명령을 만들어 사용자가 직접 켤 수 있게 안내합니다.',
    dev: 'Scope A: generate runner files and commands only; no auto-start.',
  },
  non_tty_next_command: {
    plain: '자동화 환경이라 질문을 멈추고, 안전한 기본값으로 점검한 뒤 다음 명령을 보여드립니다.',
    dev: 'Non-TTY: no readline; use defaults/answers and emit next command.',
  },
  checkOnly: {
    plain: '점검만 완료했습니다. 파일은 바꾸지 않았습니다. 적용하려면 --apply 로 다시 실행하세요.',
    dev: '--check complete; zero writes. Apply with --apply.',
  },
  applyDone: {
    plain: '적용이 끝났습니다. 변경 전 백업을 남겼고, 다음 실행 때 이어서 진행할 수 있습니다.',
    dev: '--apply complete; backups and state written.',
  },
};

export function msg(key, register = 'plain') {
  const entry = MESSAGES[key];
  if (!entry) throw new Error(`unknown message key: ${key}`);
  return entry[register] || entry.plain;
}
