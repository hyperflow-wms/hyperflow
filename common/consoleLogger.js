// Minimal leveled console logger. Level via HF_VAR_CONSOLE_LOG_LEVEL
// (error|warn|info|debug), default 'info'. File logging (log4js /
// HF_VAR_LOG_LEVEL) is independent of this.
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const name = (process.env.HF_VAR_CONSOLE_LOG_LEVEL || 'info').toLowerCase();
const level = LEVELS[name] !== undefined ? LEVELS[name] : LEVELS.info;

// Colors follow the NO_COLOR / FORCE_COLOR conventions. Auto-detection alone
// is not enough here: when the engine runs in a container its stdout is a
// pipe, so the launcher has to pass FORCE_COLOR in to say the far end of that
// pipe is a terminal.
const noColor = process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '';
const forceColor = process.env.FORCE_COLOR;
const colorEnabled = noColor ? false
  : (forceColor !== undefined && forceColor !== '' && forceColor !== '0') ? true
  : Boolean(process.stdout.isTTY);

const wrap = (codes) => (s) => colorEnabled ? '\x1b[' + codes + 'm' + s + '\x1b[0m' : String(s);

// Semantic palette: yellow = in progress, green = succeeded, red = failed,
// cyan = task name, magenta = timing, dim = identifiers and counters.
const color = {
  task: wrap('1;36'),
  started: wrap('33'),
  finished: wrap('32'),
  failed: wrap('1;31'),
  time: wrap('35'),
  dim: wrap('2'),
  warn: wrap('33'),
  ok: wrap('1;32'),
};

module.exports = {
  error: (...a) => { if (level >= 0) console.error(...a); },
  warn:  (...a) => { if (level >= 1) console.error(...a); },
  info:  (...a) => { if (level >= 2) console.log(...a); },
  debug: (...a) => { if (level >= 3) console.log(...a); },
  isDebug: level >= 3,
  color: color,
  colorEnabled: colorEnabled,
};
