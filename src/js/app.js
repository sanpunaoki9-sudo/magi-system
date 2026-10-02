import { TABS } from './tabs.js';
import { startClock } from './clock.js';
import { createLock } from './lock.js';
import { createHub } from './hub/scene.js';
import { createPanels } from './panel.js';

// 解錠するまではハブを操作できないようにする
const hubEl = document.getElementById('hub');
hubEl.inert = true;

let hub = null;
let panels = null;

// 3D の初期化に失敗しても起動画面は使えるように、ロックを先に用意する
const lock = createLock({
  onUnlock: () => {
    hubEl.inert = false;
    hub?.reveal();
  },
});
lock.init();

startClock(document.getElementById('clockTime'), document.getElementById('clockDate'));

try {
  hub = createHub({
    canvas: document.getElementById('scene'),
    tabLayer: document.getElementById('tabLayer'),
    tabs: TABS,
    onSelect: (tab, el) => panels?.open(tab, el),
  });
  panels = createPanels({ layer: document.getElementById('panelLayer'), hub });
} catch (err) {
  console.error('[hub] 3D 表示を初期化できませんでした', err);
}
