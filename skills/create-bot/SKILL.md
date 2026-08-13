---
name: create-bot
description: Use when creating a Discord bot for ThisCodex, especially when the user wants Codex to drive the Discord Developer Portal through a connected browser-automation MCP, create the application, enable required intents, receive the token safely, and invite the bot. Also use when browser automation is missing and Playwright MCP must be configured.
---

# Create a Discord bot with ThisCodex

Carry the Discord Developer Portal flow to completion. The default is browser
automation, with exactly three human-only security gates. Do not replace this
flow with a list of portal instructions when an interactive browser MCP is
available.

This is a Codex-surface port of the companion ThisCode
`skills/create-bot/SKILL.md`. Keep its portal order, intent set, permissions,
and security boundaries. This skill owns the Discord application and token
stage; use `thiscodex init` for the surrounding local bot workspace setup.

## Inputs

Confirm these before a live run:

- bot/application name;
- the ThisCodex Discord state directory that will receive `.env`;
- DM-only or a named server/private-channel exposure;
- whether the user requested `dry-run` or a live portal run.

If the state directory is not yet confirmed, stop and run guided
`thiscodex init`. Do not invent a path.

## 0. Dry-run boundary

In dry-run mode, verify this document, discover browser capabilities, and
explain the three human gates. A dry-run must not navigate to Discord, mutate
Codex configuration, create an application, reset a token, or invite a bot.

Package tests and unattended CI are always dry-run. A real browser E2E uses a
real account and therefore requires the account owner to be present.

## 0.5 Automation mode and the code gate

`thiscodex init` asks **Automatic (auto / 자동)** or **Manual (manual / 수동)**
as its first interaction. Do not ask the same question again here. Before any
manual handoff, call the shipped code gate; prose judgment is not evidence:

```bash
thiscodex automation-gate --gate <stable-gate-name> \
  --status <succeeded|failed|human_required> \
  --surface <policy-surface> --flow <policy-flow> \
  --provider <observed-provider-or-empty> --operation <policy-operation> \
  --terminal <policy-terminal> --reason-code <policy-reason-code>
```

In auto mode an unlisted gate is blocked. For attempt-required gates the CLI
accepts only a completion envelope independently written by the app-server
bridge for the current turn; flags or prose cannot claim an attempt. The first
provider observed for a flow is bound to that flow. The gate writes only
policy labels plus evidence coordinates (never arguments, page text, URL,
result, or raw error) to
`~/.config/thiscodex/automation-attempts.jsonl`.

- `handoff_allowed: false` means continue automatically; do not show manual
  instructions.
- `handoff_allowed: true` means the failed attempt or named security boundary
  is recorded. Put `<!-- thiscodex-manual-handoff -->` and the returned
  `receipt_marker` unchanged in the one necessary human-action message.
- An error or missing audit record means manual handoff is forbidden.

The only no-attempt exceptions are stable names declared with reasons in
`install/automation-policy.yaml`. A new gate is attempt-required by default.
Never add an exception merely because automation is inconvenient.

## 1. Discover browser automation by capability

Accept only the policy-listed providers `playwright` and `claude-in-chrome`,
then discover each provider's callable tool names by capability. Tool prefixes
vary, so never require a literal tool name such as
`mcp__playwright__browser_click`; the app-server completion envelope, not model
prose, proves which allowed provider actually ran.

1. Inspect the callable tool metadata exposed to the current turn. If the
   harness offers tool search, search tool descriptions as well.
2. Select one connected provider that can perform the whole interactive set:
   **navigate**, inspect a page or accessibility **snapshot**, **click**,
   **type or fill**, and **wait** then inspect again.
3. Treat registration alone (`codex mcp list`) as insufficient. The tools must
   be callable in this session.
4. Use the discovered tool names for the rest of the run. Do not use
   `web.run`, shell HTTP requests, or guessed coordinates as a substitute for
   an interactive browser.

### If the capability set is missing

Ask before changing Codex configuration or running a package:

> I can attach a browser-control tool in about a minute. Shall I register the
> Playwright MCP for Codex?

On approval, run:

```bash
codex mcp add playwright -- npx -y @playwright/mcp@latest
```

Equivalent `~/.codex/config.toml` registration:

```toml
[mcp_servers.playwright]
command = "npx"
args = ["-y", "@playwright/mcp@latest"]
```

`playwright` is the policy-listed server label. Restart Codex so the new MCP tools enter the session,
invoke this skill again, and repeat the capability check. Do not claim the
tools are usable before that re-detection.

If the user declines installation, use the manual fallback at the end and ask
the user to return only non-secret completion facts. Never ask for a token in
chat.

Before that fallback, record the consent boundary:

```bash
thiscodex automation-gate --gate browser_provider_install_declined \
  --status human_required --surface consent --flow browser-provider \
  --operation review-browser-provider-install \
  --terminal human_security_gate --reason-code operator_declined
```

If registration was approved, **run it**, restart/re-detect, and keep using the
same browser provider through the terminal page state. If registration or
re-detection fails, record that actual attempt before offering a manual path:

```bash
thiscodex automation-gate --gate browser_provider_setup \
  --status failed --surface browser --provider playwright \
  --flow browser-provider --operation register-restart-redetect-provider \
  --terminal tool_failed --reason-code provider_not_callable
```

## 2. Human-only gates

Stop only at these security boundaries, state the one action required, and
resume as soon as the resulting page is visible:

1. **Login:** the user enters Discord credentials and, when configured, MFA.
2. **New Application hCaptcha:** the user completes hCaptcha.
3. **Reset Token confirmation:** the user enters the account password and,
   when configured, MFA in the final confirmation modal.

Do not type credentials, solve a captcha, or read authentication codes. All
other portal actions are the agent's default responsibility.

Navigate or inspect with the connected provider first, then record the observed
security boundary before asking for the one human action. Use gate names
`discord_portal_login`, `discord_hcaptcha`, and
`discord_reset_token_modal`, status `human_required`, the provider and observed
operation, a non-secret reason, `--surface browser`, and
the exact flow/operation/terminal/reason-code fields from the policy. These names are the policy-declared
exceptions; the browser remains attached and must resume immediately after the
user-owned action.

## 3. Automated portal flow

Narrate each operation in one short present-tense sentence. Do not turn the
automated path into imperative instructions for the user.

1. Navigate to `https://discord.com/developers/applications`.
   - If the login page appears, pause at human gate 1.
   - Continue only after the Applications dashboard is visible.
2. Click **New Application**, fill the confirmed name, and submit.
   - If hCaptcha appears, pause at human gate 2.
3. Open **Bot**. Keep the application name and bot username distinct; update
   both if the user requested the same visible name.
4. Click **Reset Token** and accept the confirmation.
   - If password/MFA appears, pause at human gate 3.
5. Receive and store the token using the secret-safe procedure below.
6. In **Privileged Gateway Intents**, turn on both:
   - **Message Content Intent**;
   - **Server Members Intent**.

   Keep Presence Intent off unless a separate requirement says otherwise, and
   save the changes.
7. Open **OAuth2 → URL Generator** and select scopes `bot` and
   `applications.commands`.
8. Select these eleven bot permissions:
   - View Channels;
   - Send Messages;
   - Read Message History;
   - Add Reactions;
   - Attach Files;
   - Embed Links;
   - Manage Messages;
   - Create Public Threads;
   - Create Private Threads;
   - Send Messages in Threads;
   - Manage Threads.

   The corresponding reference value is `permissions=395137117248`.
9. Navigate to the generated authorization URL, select the confirmed server,
   and approve. If Discord forces a desktop-app approval window that the
   connected browser cannot operate, first attempt the approval with the same
   provider, then call `automation-gate` with gate
   `discord_desktop_approval`, `--status failed --surface browser --flow
   discord-portal`, the provider, operation `approve-discord-desktop-window`,
   terminal `tool_failed`, and reason code `provider_cannot_control_window`. Hand
   off only that approval click, and only when the gate returns
   `handoff_allowed: true`.
10. For a private channel, add the bot as a channel member. Server invitation
    alone does not grant private-channel access.

## 4. Token receipt without model exposure

Once the token is visible, do not take a screenshot or snapshot, extract page
text, inspect the DOM, or paste the value into chat.

Prefer a model-blind clipboard handoff when the host and connected browser can
support a physical click on Discord's **Copy** button:

1. Put a non-secret sentinel in the clipboard.
2. Click **Copy** without reading the token.
3. In one local command, compare against the sentinel, validate only token
   shape, write `DISCORD_BOT_TOKEN=<value>` to `<state-dir>/.env`, set mode
   `600` where supported, and clear the clipboard. Print only pass/fail,
   length, and destination — never the value.
4. If the clipboard is still the sentinel or validation fails, stop without
   changing `.env`.

On macOS, after the state directory is confirmed, use this shape. Run the
first line before the browser click and the remaining block after it. The
command prints no secret:

```bash
printf 'THISCODEX_TOKEN_NOT_COPIED' | pbcopy
# Click Discord's Copy button through the discovered browser tool here.
T="$(pbpaste)"
if [ "$T" = 'THISCODEX_TOKEN_NOT_COPIED' ]; then
  echo 'ERROR: token copy did not change the clipboard'; unset T; exit 1
fi
printf '%s' "$T" | grep -qE '^[A-Za-z0-9_.-]{50,120}$' || {
  echo 'ERROR: clipboard does not have a token-shaped value'; unset T; exit 1;
}
umask 077
printf 'DISCORD_BOT_TOKEN=%s\n' "$T" > "$STATE_DIR/.env"
chmod 600 "$STATE_DIR/.env" 2>/dev/null || true
echo "OK: token saved to $STATE_DIR/.env; length=${#T}"
unset T
printf 'CLEARED' | pbcopy
```

Use the operating system's equivalent private clipboard command elsewhere.
If no equivalent is already available, do not install another clipboard tool
without approval; use the user handoff below.

If a model-blind clipboard path is unavailable, ask the user to copy the token
directly into `<state-dir>/.env` in their terminal. The user reports only
"saved"; the token never enters the conversation.

Before showing that instruction, call `automation-gate` with gate
`token_direct_entry`, status `failed`, surface `secret`, flow `discord-token`,
provider `model-blind-clipboard`, operation `model-blind-token-receipt`,
terminal `tool_failed`, and reason code `model_blind_channel_unavailable`.
The bridge must have observed the failed clipboard command in this turn. This
gate protects the secret; it is not permission to skip the clipboard attempt.

Do not place a real token in a command literal, test fixture, log, screenshot,
git diff, or generated report.

## 5. Verify behavior, not file presence

After `.env` exists, run secret-safe checks that never print the credential:

- Discord `/users/@me` returns a username and `bot: true`;
- `/users/@me/guilds` reports at least one invited server;
- both required privileged intents are visibly on;
- the chosen channel exposure is recorded;
- `thiscodex doctor` and the local bot startup checks pass;
- a real DM or permitted-channel mention receives one bot reply.

For a private-channel failure, diagnose in this order: server membership,
private-channel membership, then the channel entry in `access.json`.

Report only the verified facts: application created, token saved (not its
value), required intents on, invited server, and channel exposure.

## Manual fallback (only after the code gate allows it)

Guide the user through the same ordered portal flow, including the same three
human gates, two required intents, two scopes, eleven permissions, private
channel membership, and secret-safe `.env` storage. Do not weaken the
verification checklist merely because the clicks were manual.

For every browser run, keep the selected `playwright` or `claude-in-chrome`
provider in use from the first navigation until
one terminal state: completed, a policy-declared human security gate, or a
recorded tool/provider failure. Starting a provider and silently switching to
instructions is forbidden. Every browser terminal reason must be present in
the automation audit before a manual handoff.

## References

- Companion source of truth: ThisCode `skills/create-bot/SKILL.md`.
- Codex mapping: `docs/tool-equivalence-contract.md`.
- Installation: `docs/SETUP.md` §3.
