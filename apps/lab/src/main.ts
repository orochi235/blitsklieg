import {
  type ActiveName,
  type Blitsklieg,
  type EnterName,
  type ExitName,
  type FireOptions,
  type LookName,
  type QueuePolicy,
  createBlitsklieg,
} from '@blitsklieg/core';

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`lab: the page has no #${id}`);
  return found as T;
}

const logEl = el<HTMLPreElement>('log');
const lines: string[] = [];

function log(line: string): void {
  lines.push(`${new Date().toLocaleTimeString()} ${line}`);
  if (lines.length > 40) lines.shift();
  logEl.textContent = lines.join('\n');
  logEl.scrollTop = logEl.scrollHeight;
}

/**
 * Names from an exhaustive record rather than a hand-written list: one the package drops or
 * renames fails typecheck here instead of becoming an undefined lookup at fire time.
 */
function namesOf<T extends string>(names: Record<T, true>): T[] {
  return Object.keys(names) as T[];
}

const ENTER_NAMES = namesOf<EnterName>({
  slam: true,
  spin: true,
  flip: true,
  assemble: true,
  rise: true,
  none: true,
});
const ACTIVE_NAMES = namesOf<ActiveName>({
  sweep: true,
  float: true,
  pulse: true,
  shimmer: true,
  none: true,
});
const EXIT_NAMES = namesOf<ExitName>({
  fade: true,
  shatter: true,
  drop: true,
  recede: true,
  none: true,
});
const LOOK_NAMES = namesOf<LookName>({ gold: true, chrome: true, oil: true, ruby: true });
const POLICY_NAMES = namesOf<QueuePolicy>({ queue: true, replace: true, concurrent: true });

function choice<T extends string>(id: string, names: readonly T[]) {
  const select = el<HTMLSelectElement>(id);
  for (const name of names) select.add(new Option(name));
  return { select, get: () => select.value as T };
}

const enter = choice('enter', ENTER_NAMES);
const active = choice('active', ACTIVE_NAMES);
const exit = choice('exit', EXIT_NAMES);
const look = choice('look', LOOK_NAMES);
const policy = choice('policy', POLICY_NAMES);

const textInput = el<HTMLInputElement>('text');
const bloomInput = el<HTMLInputElement>('bloom');
const number = (id: string) => Number(el<HTMLInputElement>(id).value);

function create(): Blitsklieg {
  const instance = createBlitsklieg({ fontUrl: '/font.ttf', policy: policy.get() });
  log(`instance up (policy ${policy.get()}${instance.supported ? '' : ', webgl2 UNSUPPORTED'})`);
  return instance;
}

let bk = create();

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function fire(text: string): void {
  log(`fire "${text}"`);
  bk.fire(text, {
    enter: enter.get(),
    active: active.get(),
    exit: exit.get(),
    look: look.get(),
    hold: number('hold'),
    blendMs: number('blend'),
    bloom: bloomInput.checked,
    placement: { kind: 'fullscreen' },
  }).then(
    () => log(`gone  "${text}"`),
    (err: unknown) => {
      log(`FAILED "${text}": ${message(err)}`);
      console.error(err);
    },
  );
}

interface Step extends FireOptions {
  text: string;
}

const SEQUENCES: { name: string; steps: Step[] }[] = [
  {
    name: 'enters',
    steps: ENTER_NAMES.filter((name) => name !== 'none').map((name) => ({
      text: name.toUpperCase(),
      enter: name,
      active: 'none',
      exit: 'fade',
      hold: 400,
    })),
  },
  {
    name: 'looks',
    steps: LOOK_NAMES.map((name) => ({
      text: name.toUpperCase(),
      look: name,
      enter: 'rise',
      active: 'sweep',
      exit: 'recede',
      hold: 900,
    })),
  },
  {
    name: 'moment',
    steps: [
      { text: 'THREE', enter: 'rise', active: 'float', exit: 'recede', look: 'chrome', hold: 150 },
      { text: 'TWO', enter: 'rise', active: 'float', exit: 'recede', look: 'chrome', hold: 150 },
      { text: 'ONE', enter: 'rise', active: 'pulse', exit: 'recede', look: 'oil', hold: 150 },
      {
        text: 'JACKPOT!',
        enter: 'slam',
        active: 'sweep',
        exit: 'shatter',
        look: 'gold',
        hold: 2400,
        bloom: true,
      },
    ],
  },
];

let playing = false;

async function play(sequence: (typeof SEQUENCES)[number]): Promise<void> {
  if (playing) return;
  playing = true;
  // Disabled rather than silently ignored: a sequence runs for seconds, and the greyed button is
  // the only cue that a second click would do nothing.
  for (const button of sequenceButtons) button.disabled = true;
  log(`sequence "${sequence.name}"`);
  try {
    for (const { text, ...options } of sequence.steps) {
      await bk.fire(text, options);
      log(`  played "${text}"`);
    }
    log(`sequence "${sequence.name}" done`);
  } catch (err) {
    log(`sequence "${sequence.name}" FAILED: ${message(err)}`);
    console.error(err);
  } finally {
    playing = false;
    for (const button of sequenceButtons) button.disabled = false;
  }
}

const sequenceRow = el('sequences');
const sequenceButtons = SEQUENCES.map((sequence) => {
  const button = document.createElement('button');
  button.textContent = sequence.name;
  button.addEventListener('click', () => void play(sequence));
  sequenceRow.append(button);
  return button;
});

const fireCurrent = () => fire(textInput.value);

el('fire').addEventListener('click', fireCurrent);
el('burst').addEventListener('click', () => {
  for (const n of [1, 2, 3]) fire(`${textInput.value} ${n}`);
});
el('destroy').addEventListener('click', () => {
  bk.destroy();
  log('destroyed');
  bk = create();
});
policy.select.addEventListener('change', () => {
  bk.destroy();
  bk = create();
});

textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') fireCurrent();
});
addEventListener('keydown', (e) => {
  // Space must not swallow typing, nor double-fire the button it already activated.
  const inPanel = e.target instanceof HTMLElement && e.target.closest('.panel') !== null;
  if (e.code !== 'Space' || inPanel) return;
  e.preventDefault();
  fireCurrent();
});

addEventListener('unhandledrejection', (e) => log(`unhandled rejection: ${String(e.reason)}`));
addEventListener('error', (e) => log(`error: ${e.message}`));

if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
  log('prefers-reduced-motion is on — the type holds a pose instead of travelling');
}

el('filler').textContent = 'Filler copy so the page scrolls. '.repeat(60);
