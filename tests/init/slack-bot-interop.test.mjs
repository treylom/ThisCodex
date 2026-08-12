import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const skill = read('skills/slack-bridge/SKILL.md');
const changes = read('docs/RECENT-CHANGES.md');

test('Slack bridge guide ports the live allowlist plus explicit-mention gate', () => {
  assert.match(skill, /ALLOWED_SLACK_BOT_USER_IDS/);
  assert.match(skill, /사용자 ID\(`U…`, `B…` bot ID 아님\)/u);
  assert.match(skill, /ALLOWED_BOT_USER_IDS = frozenset/);
  assert.match(skill, /sender not in ALLOWED_BOT_USER_IDS/);
  assert.match(skill, /message\.get\("channel_type"\) == "im"/);
  assert.match(skill, /mention_me = f"<@\{context\.bot_user_id\}>"/);
  assert.match(skill, /or not mention_me/);
  assert.match(skill, /목록이 없거나 비어 있으면 모든 봇 발화를 버려/u);
  assert.match(skill, /IgnoringSelfEvents/);
  assert.match(skill, /작성자 `user`가 없는 봇 이벤트도 빈 문자열이라 허용목록을 통과하지 못한다/u);
  assert.match(skill, /사람 발화의 기존 라우팅은 그대로/u);
  assert.match(skill, /왕복 횟수 상한은 두지 않는다/u);
  assert.match(
    skill,
    /각 봇이 자기 `AGENT_BRIDGE_ENGINE`으로 1회씩 응답해 서로의 발화를 참고하는지 확인/u,
  );
  assert.match(skill, /`\[claude\]`·`\[codex\]` 접두사로 각자 지정 엔진을 탔는지도 판독/u);
});

test('Slack bridge guide rejects the stale blanket bot-message drop', () => {
  assert.doesNotMatch(
    skill,
    /봇간 무한루프 가드:\s*수신 메시지에 `bot_id` 가 실려 있으면.*응답하지 않는다/u,
  );
  assert.match(skill, /양방향 회의에는 양쪽 설정이 모두 필요/u);
  assert.match(changes, /Slack bot-to-bot meeting gate restored/);
  assert.match(changes, /Unset or empty allowlists preserve the old fail-closed behavior/);
});
