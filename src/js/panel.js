// 丸タブをクリックすると、その丸がそのまま広がってパネルになる。
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const OPEN_MS = reduceMotion ? 1 : 560;
const CLOSE_MS = reduceMotion ? 1 : 460;
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

function targetRect() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const width = Math.min(1280, w * 0.86);
  const height = Math.min(860, h * 0.84);
  return { left: (w - width) / 2, top: (h - height) / 2, width, height, radius: 28 };
}

function circleRect(el) {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height, radius: r.width / 2 };
}

const frame = (r) => ({
  left: `${r.left}px`,
  top: `${r.top}px`,
  width: `${r.width}px`,
  height: `${r.height}px`,
  borderRadius: `${r.radius}px`,
});

function renderPlaceholder(body, tab) {
  const wrap = document.createElement('div');
  wrap.className = 'placeholder';

  const summary = document.createElement('p');
  summary.className = 'placeholder-summary';
  summary.textContent = tab.summary;

  const list = document.createElement('ul');
  list.className = 'placeholder-list';
  for (const feature of tab.features) {
    const li = document.createElement('li');
    li.textContent = feature;
    list.append(li);
  }

  const note = document.createElement('span');
  note.className = 'placeholder-note';
  note.textContent = 'COMING NEXT';

  wrap.append(summary, list, note);
  body.append(wrap);
}

export function createPanels({ layer, hub, modules = {} }) {
  let current = null;

  async function close() {
    if (!current || current.closing) return;
    const { panel, content, source, tab } = current;
    current.closing = true;

    hub.unfocus();
    document.getElementById('hub').classList.remove('is-focused');

    await content.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: 'forwards' }).finished;
    const from = frame(targetRect());
    const to = frame(circleRect(source));
    await panel.animate([from, to], { duration: CLOSE_MS, easing: EASE, fill: 'forwards' }).finished;

    source.classList.remove('is-source');
    panel.remove();
    modules[tab.id]?.unmount?.();
    current = null;
    source.focus({ preventScroll: true });
  }

  async function open(tab, source) {
    if (current) return;

    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', tab.ja);

    const content = document.createElement('div');
    content.className = 'panel-content';
    content.innerHTML = `
      <header class="panel-header">
        <div class="panel-title">
          <span class="panel-title-en"></span>
          <span class="panel-title-ja"></span>
        </div>
        <button type="button" class="panel-close" aria-label="閉じる"></button>
      </header>
      <div class="panel-body"></div>`;
    content.querySelector('.panel-title-en').textContent = tab.en;
    content.querySelector('.panel-title-ja').textContent = tab.ja;
    content.querySelector('.panel-close').addEventListener('click', close);
    panel.append(content);

    const body = content.querySelector('.panel-body');
    const module = modules[tab.id];
    if (module) module.mount(body);
    else renderPlaceholder(body, tab);

    const from = frame(circleRect(source));
    Object.assign(panel.style, from);
    layer.append(panel);
    source.classList.add('is-source');
    current = { panel, content, source, tab, closing: false };

    hub.focus(tab.id);
    document.getElementById('hub').classList.add('is-focused');

    const to = frame(targetRect());
    await panel.animate([from, to], { duration: OPEN_MS, easing: EASE, fill: 'forwards' }).finished;
    Object.assign(panel.style, to);
    content.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], {
      duration: 260,
      easing: EASE,
      fill: 'forwards',
    });
    content.querySelector('.panel-close').focus({ preventScroll: true });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  window.addEventListener('resize', () => {
    if (current && !current.closing) {
      current.panel.getAnimations().forEach((a) => a.cancel());
      Object.assign(current.panel.style, frame(targetRect()));
    }
  });

  return { open, close };
}
