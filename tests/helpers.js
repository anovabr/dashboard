// Shared setup for both boards.
//
// Both pages boot the same way: detect storage, load state, then
//   if (getPw()) doSync(true); else showGate();
// So every test either seeds `task-board-pw` (to get past the gate) or
// deliberately leaves it out (to test the gate itself). The GitHub API is
// always intercepted -- nothing in this suite talks to the network.

const PW = 'test-password';

/**
 * Seed localStorage before any page script runs.
 *
 * Seeds once per tab: "exit" ends in location.reload(), and re-seeding on that
 * reload would put back the very password the test just cleared.
 */
async function seedStorage(page, entries) {
  await page.addInitScript((kv) => {
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    for (const [k, v] of Object.entries(kv)) {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
  }, entries);
}

/**
 * Intercept api.github.com.
 *   mode 'missing'    -> 404, the "no file on the branch yet" path
 *   mode 'garbage'    -> 200 with a body that is not our payload
 *   mode 'state'      -> 200 with `remote` as a plaintext (unencrypted) payload
 * Every PUT is recorded so a test can assert a write did or did not happen.
 */
async function stubGithub(page, { mode = 'missing', remote = null } = {}) {
  const writes = [];
  await page.route('**://api.github.com/**', async (route) => {
    const req = route.request();
    if (req.method() === 'PUT') {
      writes.push(JSON.parse(req.postData() || '{}'));
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ content: { sha: 'newsha' } }),
      });
    }
    if (mode === 'missing') {
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    }
    const payload = mode === 'garbage' ? 'this is not json at all' : JSON.stringify(remote);
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        sha: 'abc123',
        content: Buffer.from(payload, 'utf8').toString('base64'),
      }),
    });
  });
  return writes;
}

/** Open the task board, already unlocked unless `locked` is set. */
async function openBoard(page, opts = {}) {
  const { locked = false, state = null, token = null, github = {} } = opts;
  const writes = await stubGithub(page, github);
  await seedStorage(page, {
    'task-board-pw': locked ? null : PW,
    'task-board-sync': token,
    'task-board-v2': state,
  });
  await page.goto('/index.html');
  if (!locked) await page.waitForFunction(() => !!window.__dbg && !!window.__dbg.state());
  return writes;
}

/** Open the manuscript tracker, already unlocked unless `locked` is set. */
async function openMs(page, opts = {}) {
  const { locked = false, papers = [], state = null, token = null, github = {} } = opts;
  const writes = await stubGithub(page, github);
  await seedStorage(page, {
    'task-board-pw': locked ? null : PW,
    'task-board-sync': token,
    'manuscript-crm-v1': state || { papers, changelog: [], view: 'table',
      sort: { col: 'lastUpdate', dir: -1 }, delayDays: 45, theme: 'auto' },
  });
  await page.goto('/manuscripts.html');
  if (!locked) await page.waitForFunction(() => !!window.__ms && !!window.__ms.state());
  return writes;
}

/**
 * HTML5 drag and drop, dispatched by hand.
 *
 * Both pages listen for dragstart/dragover/drop on `document` and route on
 * `e.target.closest(...)`, so real DragEvents on the right nodes exercise the
 * production path exactly. Doing it by hand (rather than via mouse moves) keeps
 * it deterministic -- synthesized native DnD is timing-dependent in Chromium.
 */
async function html5Drag(page, source, target) {
  const src = await (typeof source === 'string' ? page.locator(source) : source).first().elementHandle();
  const dst = await (typeof target === 'string' ? page.locator(target) : target).first().elementHandle();
  await page.evaluate(([s, d]) => {
    const dt = new DataTransfer();
    const fire = (node, type) =>
      node.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    fire(s, 'dragstart');
    fire(d, 'dragover');
    fire(d, 'drop');
    fire(s, 'dragend');
  }, [src, dst]);
}

/** A click that started >6px away -- what a text drag-select ends with. */
async function dragThenClick(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  await page.mouse.move(box.x + 6, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 6, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
}

const iso = (daysAgo) => new Date(Date.now() - daysAgo * 864e5).toISOString();

module.exports = { PW, openBoard, openMs, seedStorage, stubGithub, html5Drag, dragThenClick, iso };
