import {
  ACTIVE_NAMES,
  type Blitsklieg,
  createBlitsklieg,
  ENTER_NAMES,
  EXIT_NAMES,
  type FireOptions,
  LIGHTING_NAMES,
  LOOK_NAMES,
  type Look,
  POLICY_NAMES,
  specOf,
} from 'blitsklieg';

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

function choice<T extends string>(id: string, names: readonly T[]) {
  const select = el<HTMLSelectElement>(id);
  for (const name of names) select.add(new Option(name));
  return { select, get: () => select.value as T };
}

const enter = choice('enter', ENTER_NAMES);
const active = choice('active', ACTIVE_NAMES);
const exit = choice('exit', EXIT_NAMES);
const look = choice('look', LOOK_NAMES);
const lighting = choice('lighting', LIGHTING_NAMES);
const policy = choice('policy', POLICY_NAMES);

const textInput = el<HTMLTextAreaElement>('text');
const bloomInput = el<HTMLInputElement>('bloom');
const wrapInput = el<HTMLInputElement>('wrap');
const tintInput = el<HTMLInputElement>('tint');
const tintOnInput = el<HTMLInputElement>('tintOn');
const holdClickInput = el<HTMLInputElement>('holdClick');
const modalInput = el<HTMLInputElement>('modal');
const grainInput = el<HTMLInputElement>('grain');
const number = (id: string) => Number(el<HTMLInputElement>(id).value);

/**
 * Every control's value, base64 in the hash. Tuning a shader means reloading constantly, and
 * losing the whole panel on each reload makes comparing two settings impossible.
 */
const CONTROL_IDS = [
  'text',
  'enter',
  'active',
  'exit',
  'look',
  'lighting',
  'policy',
  'hold',
  'blend',
  'grain',
  'tint',
  'tintOn',
  'bloom',
  'wrap',
  'holdClick',
  'modal',
];

type ControlState = Record<string, string | boolean>;

function controls(): HTMLInputElement[] {
  return CONTROL_IDS.map((id) => el<HTMLInputElement>(id));
}

function readState(): ControlState {
  const state: ControlState = {};
  for (const input of controls()) {
    state[input.id] = input.type === 'checkbox' ? input.checked : input.value;
  }
  return state;
}

function writeState(state: ControlState): void {
  for (const input of controls()) {
    const value = state[input.id];
    if (value === undefined) continue;
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else input.value = String(value);
  }
}

function saveHash(): void {
  // replaceState rather than location.hash: assigning the hash pushes a history entry, and
  // tweaking a slider would bury the back button under hundreds of them.
  const encoded = btoa(encodeURIComponent(JSON.stringify(readState())));
  history.replaceState(null, '', `#${encoded}`);
}

function loadHash(): void {
  const raw = location.hash.slice(1);
  if (!raw) return;
  try {
    writeState(JSON.parse(decodeURIComponent(atob(raw))) as ControlState);
  } catch {
    // A hand-edited or truncated hash is not worth failing the page over.
    log('ignored an unreadable hash');
  }
}

/**
 * The slider reads as cells per em, which is the way to think about grain — bigger number,
 * finer flakes. Zero leaves the look's own tuning alone.
 */
function chosenLook(): Look {
  const name = look.get();
  const cellsPerEm = number('grain');
  const spec = specOf(name);
  if (!cellsPerEm || !spec.flake) return name;
  return { ...spec, flake: { ...spec.flake, size: 1 / cellsPerEm } };
}

function create(): Blitsklieg {
  const instance = createBlitsklieg({
    fontUrl: `${import.meta.env.BASE_URL}font.ttf`,
    policy: policy.get(),
  });
  log(`instance up (policy ${policy.get()}${instance.supported ? '' : ', webgl2 UNSUPPORTED'})`);
  return instance;
}

let bk = create();

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function fire(text: string): void {
  log(`fire ${JSON.stringify(text)}`);
  bk.fire(text, {
    enter: enter.get(),
    active: active.get(),
    exit: exit.get(),
    look: chosenLook(),
    lighting: lighting.get(),
    tint: tintOnInput.checked ? Number.parseInt(tintInput.value.slice(1), 16) : undefined,
    hold: holdClickInput.checked ? 'click' : number('hold'),
    blendMs: number('blend'),
    bloom: bloomInput.checked,
    wrap: wrapInput.checked,
    modal: modalInput.checked,
    placement: { kind: 'fullscreen' },
  }).then(
    () => log(`done  ${JSON.stringify(text)}`),
    (err: unknown) => {
      log(`FAILED ${JSON.stringify(text)}: ${message(err)}`);
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
      active: 'none',
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
        active: 'none',
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
  // Captured once: bk may be reassigned mid-sequence (DESTROY, policy change), and this
  // instance's fire() must keep resolving instead of handing later steps to a new one.
  const instance = bk;
  try {
    for (const { text, ...options } of sequence.steps) {
      await instance.fire(text, options);
      log(`  done  "${text}"`);
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

// Enter fires, Shift+Enter breaks the line — the convention every chat box uses.
textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    fireCurrent();
  }
});

// Greyed rather than ignored: only the flake looks read a grain, and a live slider that does
// nothing reads as a broken slider.
function syncGrain(): void {
  grainInput.disabled = specOf(look.get()).flake === undefined;
}

loadHash();
syncGrain();
for (const input of controls()) {
  input.addEventListener('change', () => {
    syncGrain();
    saveHash();
  });
  input.addEventListener('input', saveHash);
}

holdClickInput.addEventListener('change', () => {
  modalInput.disabled = !holdClickInput.checked;
  if (!holdClickInput.checked) modalInput.checked = false;
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
