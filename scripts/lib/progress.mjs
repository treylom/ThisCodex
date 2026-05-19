const CADENCE_TO_SECONDS = {
  per_task: 0,
  '1m': 60,
  '3m': 180,
  '5m': 300,
  off: 0,
  custom: 0,
};

export function normalizeProgressCadence(value) {
  return Object.hasOwn(CADENCE_TO_SECONDS, value) ? value : 'per_task';
}

export function progressConfigForState(state = {}) {
  const cadence = normalizeProgressCadence(
    state.answers?.progress_report_cadence ||
    state.progress_report_cadence ||
    state.detected?.progress_report_cadence ||
    'per_task'
  );
  const heartbeat = CADENCE_TO_SECONDS[cadence];
  const mode = heartbeat > 0 ? 'heartbeat'
    : cadence === 'off' ? 'off'
    : cadence === 'custom' ? 'custom'
    : 'on_complete';
  return {
    progress_report_cadence: cadence,
    heartbeat_interval_sec: heartbeat,
    mode,
  };
}

export function progressEnvForState(state = {}, prefix = 'THISCODEX') {
  const cfg = progressConfigForState(state);
  return {
    [`${prefix}_PROGRESS_CADENCE`]: cfg.progress_report_cadence,
    [`${prefix}_HEARTBEAT_SEC`]: String(cfg.heartbeat_interval_sec),
  };
}
