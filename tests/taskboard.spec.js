const { test, expect } = require('@playwright/test');
const { openBoard, html5Drag, dragThenClick, iso } = require('./helpers');

// A task pinned to This Week is drawn twice -- once in the This Week card and
// once in its own section -- so every row lookup is scoped to This Week.
const row = (text) => `#sec-week li[data-id]:has(.txt:text-is("${text}"))`;

// The board always merges its seed in, so tests add uniquely-named tasks
// and assert on those rather than assuming an empty board.
const uniq = (p) => `${p}-${Math.random().toString(36).slice(2, 8)}`;

async function addWeekTask(page, text) {
  await page.locator('.addrow[data-add="week"]').click();
  const input = page.locator('.addrow[data-add="week"] input');
  await input.fill(text);
  await input.press('Enter');
  await expect(page.locator(`#sec-week li[data-id]`).filter({ hasText: text })).toHaveCount(1);
}

test.describe('password gate', () => {
  test('locks the board when no password is stored', async ({ page }) => {
    await openBoard(page, { locked: true });
    await expect(page.locator('#gate')).toHaveClass(/on/);
    await expect(page.locator('#gatepw')).toBeVisible();
  });

  test('unlocks on Enter and stores the password on this device only', async ({ page }) => {
    await openBoard(page, { locked: true });
    await page.locator('#gatepw').fill('hunter2');
    await page.locator('#gatepw').press('Enter');
    await expect(page.locator('#gate')).not.toHaveClass(/on/);
    expect(await page.evaluate(() => localStorage.getItem('task-board-pw'))).toBe('hunter2');
  });

  test('refuses an empty password', async ({ page }) => {
    await openBoard(page, { locked: true });
    await page.locator('#gatego').click();
    await expect(page.locator('#gateerr')).toHaveText('Type the password.');
    await expect(page.locator('#gate')).toHaveClass(/on/);
  });

  test('"forgot the password" explains there is no recovery', async ({ page }) => {
    await openBoard(page, { locked: true });
    await page.locator('#forgotLink').click();
    await expect(page.locator('#forgotBox')).toHaveClass(/on/);
    await expect(page.locator('#forgotBox')).toContainText('no recovery');
  });
});

test.describe('add, edit, delete', () => {
  test('adds a task to This Week and pins it', async ({ page }) => {
    await openBoard(page);
    const text = uniq('write the thing');
    await addWeekTask(page, text);
    const t = await page.evaluate((x) => window.__dbg.state().tasks.find((t) => t.text === x), text);
    expect(t.week).toBe(true);
    expect(t.status).toBe('now');
  });

  test('two tasks added back to back both land', async ({ page }) => {
    // the first box's blur timer fires 150ms later; it must not close the second
    await openBoard(page);
    const a = uniq('first of two'), b = uniq('second of two');
    await addWeekTask(page, a);
    await addWeekTask(page, b);
    await expect(page.locator(row(a))).toHaveCount(1);
    await expect(page.locator(row(b))).toHaveCount(1);
  });

  test('splits "Project — task" into project and text', async ({ page }) => {
    await openBoard(page);
    const text = uniq('draft intro');
    await addWeekTask(page, `Murray — ${text}`);
    const t = await page.evaluate((x) => window.__dbg.state().tasks.find((t) => t.text === x), text);
    expect(t.proj).toBe('Murray');
  });

  test('edits the text of a row on double click', async ({ page }) => {
    await openBoard(page);
    const text = uniq('before');
    await addWeekTask(page, text);
    await page.locator(row(text)).locator('.txt').dblclick();
    const input = page.locator('#sec-week .inline-edit');
    await input.fill('after the edit');
    await input.press('Enter');
    await expect(page.locator('#sec-week').getByText('after the edit')).toBeVisible();
  });

  test('deletes a row and records a tombstone rather than dropping it', async ({ page }) => {
    await openBoard(page);
    const text = uniq('delete me');
    await addWeekTask(page, text);
    const id = await page.evaluate((x) => window.__dbg.state().tasks.find((t) => t.text === x).id, text);
    await page.locator(row(text)).locator('.rowbtn.del').click();
    await expect(page.locator(row(text))).toHaveCount(0);
    const t = await page.evaluate((i) => window.__dbg.state().tasks.find((t) => t.id === i), id);
    expect(t.status).toBe('gone');
  });

  test('undo brings a deleted row back', async ({ page }) => {
    await openBoard(page);
    const text = uniq('undo me');
    await addWeekTask(page, text);
    await page.locator(row(text)).locator('.rowbtn.del').click();
    await expect(page.locator(row(text))).toHaveCount(0);
    await page.locator('#undoBtn').click();
    await expect(page.locator(row(text))).toHaveCount(1);
  });

  test('the star pins and unpins from This Week', async ({ page }) => {
    await openBoard(page);
    const text = uniq('pin me');
    await addWeekTask(page, text);
    await page.locator(row(text)).locator('.rowbtn.star').click();
    const t = await page.evaluate((x) => window.__dbg.state().tasks.find((t) => t.text === x), text);
    expect(t.week).toBeFalsy();
  });

  test('the date field reads "due" as hard and "aim" as soft', async ({ page }) => {
    await openBoard(page);
    const text = uniq('dated');
    await addWeekTask(page, text);
    await page.locator(row(text)).locator('.date').click();
    const input = page.locator(`${row(text)} .inline-edit.small`);
    await input.fill('due 7/31');
    await input.press('Enter');
    const t = await page.evaluate((x) => window.__dbg.state().tasks.find((t) => t.text === x), text);
    expect(t.date).toEqual({ kind: 'hard', label: 'due 7/31' });
  });
});

test.describe('the docked selection bar', () => {
  test('ticking a box selects rather than completing', async ({ page }) => {
    await openBoard(page);
    const text = uniq('select me');
    await addWeekTask(page, text);
    await page.locator(row(text)).locator('.box').click();
    await expect(page.locator('.actmenu.selbar')).toBeVisible();
    await expect(page.locator('.actmenu.selbar .selct')).toHaveText('1 selected');
    const t = await page.evaluate((x) => window.__dbg.state().tasks.find((t) => t.text === x), text);
    expect(t.status).not.toBe('done');
  });

  test('Complete on the bar finishes every selected row', async ({ page }) => {
    await openBoard(page);
    const a = uniq('first'), b = uniq('second');
    await addWeekTask(page, a);
    await addWeekTask(page, b);
    await page.locator(row(a)).locator('.box').click();
    await page.locator(row(b)).locator('.box').click();
    await expect(page.locator('.actmenu.selbar .selct')).toHaveText('2 selected');
    await page.locator('.actmenu.selbar button[data-act="done"]').click();
    const states = await page.evaluate(([x, y]) => {
      const s = window.__dbg.state().tasks;
      return [s.find((t) => t.text === x).status, s.find((t) => t.text === y).status];
    }, [a, b]);
    expect(states).toEqual(['done', 'done']);
  });

  test('Escape clears the selection', async ({ page }) => {
    await openBoard(page);
    const text = uniq('escape me');
    await addWeekTask(page, text);
    await page.locator(row(text)).locator('.box').click();
    await expect(page.locator('.actmenu.selbar')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.actmenu.selbar')).toHaveCount(0);
  });
});

test.describe('drag and drop', () => {
  test('dropping a task on the Today column moves it to Today', async ({ page }) => {
    await openBoard(page);
    const text = uniq('do today');
    await addWeekTask(page, text);
    await html5Drag(page, `${row(text)}`, '#col-tdy');
    const t = await page.evaluate((x) => window.__dbg.state().tasks.find((t) => t.text === x), text);
    expect(t.today).toBe(true);
    await expect(page.locator(`#list-today li[data-id]`).filter({ hasText: text })).toHaveCount(1);
  });

  test('dropping on the Tomorrow column plans it for tomorrow', async ({ page }) => {
    await openBoard(page);
    const text = uniq('do tomorrow');
    await addWeekTask(page, text);
    await html5Drag(page, `${row(text)}`, '#col-tmr');
    const t = await page.evaluate((x) => window.__dbg.state().tasks.find((t) => t.text === x), text);
    expect(t.tomorrow).toBe(true);
    expect(t.today).toBe(false);
  });

  test('dropping a task on another section moves it there', async ({ page }) => {
    await openBoard(page);
    const text = uniq('relocate');
    await addWeekTask(page, text);
    await html5Drag(page, `${row(text)}`, '#sec-personal');
    const t = await page.evaluate((x) => window.__dbg.state().tasks.find((t) => t.text === x), text);
    expect(t.sec).toBe('personal');
  });
});

test.describe('section notes', () => {
  test('adds a note and shows the count on the section', async ({ page }) => {
    await openBoard(page);
    await page.locator('.notebtn[data-note="personal"]').click();
    await expect(page.locator('.notepanel')).toBeVisible();
    await page.locator('.notepanel .npadd').fill('remember the milk');
    await page.locator('.notepanel .npadd').press('Enter');
    await expect(page.locator('.notepanel .nplist li')).toHaveCount(1);
    await expect(page.locator('.notebtn[data-note="personal"] .nct')).toHaveText('1');
  });

  test('deletes a note', async ({ page }) => {
    await openBoard(page);
    await page.locator('.notebtn[data-note="personal"]').click();
    await page.locator('.notepanel .npadd').fill('temporary');
    await page.locator('.notepanel .npadd').press('Enter');
    await expect(page.locator('.notepanel .nplist li')).toHaveCount(1);
    await page.locator('.notepanel .npx').click();
    await expect(page.locator('.notepanel .npempty')).toBeVisible();
  });

  test('notes survive a re-render and land in state under the section key', async ({ page }) => {
    await openBoard(page);
    await page.locator('.notebtn[data-note="anova"]').click();
    await page.locator('.notepanel .npadd').fill('kept across renders');
    await page.locator('.notepanel .npadd').press('Enter');
    const notes = await page.evaluate(() => window.__dbg.state().notes.anova);
    expect(notes).toHaveLength(1);
    expect(notes[0].t).toBe('kept across renders');
  });
});

test.describe('sync merge', () => {
  test('a newer remote record wins', async ({ page }) => {
    await openBoard(page);
    const text = uniq('local version');
    await addWeekTask(page, text);
    const id = await page.evaluate((x) => window.__dbg.state().tasks.find((t) => t.text === x).id, text);
    await page.evaluate(({ id }) => {
      window.__dbg.merge({ tasks: [{ id, text: 'remote version', updatedAt: new Date(Date.now() + 6e4).toISOString() }] });
    }, { id });
    const t = await page.evaluate((i) => window.__dbg.state().tasks.find((t) => t.id === i), id);
    expect(t.text).toBe('remote version');
  });

  test('an older remote record loses', async ({ page }) => {
    await openBoard(page);
    const text = uniq('keep mine');
    await addWeekTask(page, text);
    const id = await page.evaluate((x) => window.__dbg.state().tasks.find((t) => t.text === x).id, text);
    await page.evaluate(({ id, old }) => {
      window.__dbg.merge({ tasks: [{ id, text: 'stale remote', updatedAt: old }] });
    }, { id, old: iso(3) });
    const t = await page.evaluate((i) => window.__dbg.state().tasks.find((t) => t.id === i), id);
    expect(t.text).toBe(text);
  });

  test('an unknown remote record is added', async ({ page }) => {
    await openBoard(page);
    await page.evaluate(() => {
      window.__dbg.merge({ tasks: [{ id: 'from-elsewhere', sec: 'personal', text: 'arrived by sync',
        status: 'planning', updatedAt: new Date().toISOString() }] });
    });
    await expect(page.locator('#sec-personal').getByText('arrived by sync')).toBeVisible();
  });

  test('a section deleted elsewhere stays deleted here', async ({ page }) => {
    await openBoard(page);
    await page.evaluate(() => { window.__dbg.merge({ tasks: [], removedSections: ['anova'] }); });
    await expect(page.locator('#sec-anova')).toHaveCount(0);
  });

  test('a background merge never clobbers an open editor', async ({ page }) => {
    await openBoard(page);
    const text = uniq('typing here');
    await addWeekTask(page, text);
    await page.locator(row(text)).locator('.txt').dblclick();
    await page.locator('#sec-week .inline-edit').fill('half-typed thought');
    // syncRender is the path a background sync takes; it must defer while an
    // input is focused and hold the render until the field is done with.
    await page.evaluate(() => window.__dbg.syncRender());
    await expect(page.locator('#sec-week .inline-edit')).toHaveValue('half-typed thought');
    expect(await page.evaluate(() => window.__dbg.pending())).toBe(true);
  });

  test('the deferred render lands once the editor closes', async ({ page }) => {
    await openBoard(page);
    const text = uniq('deferred');
    await addWeekTask(page, text);
    await page.locator(row(text)).locator('.txt').dblclick();
    await page.evaluate(() => {
      window.__dbg.state().tasks.push({ id: 'late-arrival', sec: 'personal',
        text: 'pushed mid-edit', status: 'planning', updatedAt: new Date().toISOString() });
      window.__dbg.syncRender();
    });
    await page.locator('#sec-week .inline-edit').press('Escape');
    await expect(page.locator('#sec-personal').getByText('pushed mid-edit')).toBeVisible();
  });
});

test.describe('backup import', () => {
  test('imports a backup file and merges it by updatedAt', async ({ page }) => {
    await openBoard(page);
    const backup = {
      tasks: [{ id: 'imported-1', sec: 'personal', text: 'came from the backup',
        status: 'planning', updatedAt: new Date().toISOString() }],
    };
    await page.locator('#importFile').setInputFiles({
      name: 'taskboard-backup.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup)),
    });
    await expect(page.locator('#diagCopied')).toContainText('backup loaded');
    await expect(page.locator('#sec-personal').getByText('came from the backup')).toBeVisible();
  });

  test('rejects a file with no tasks instead of wiping the board', async ({ page }) => {
    await openBoard(page);
    const before = await page.evaluate(() => window.__dbg.state().tasks.length);
    await page.locator('#importFile').setInputFiles({
      name: 'junk.json', mimeType: 'application/json', buffer: Buffer.from('{"nope":1}'),
    });
    await expect(page.locator('#diagCopied')).toContainText('import failed');
    expect(await page.evaluate(() => window.__dbg.state().tasks.length)).toBe(before);
  });
});

test.describe('drag-select must not be read as a click', () => {
  test('drag-selecting a subsection heading does not fold it', async ({ page }) => {
    await openBoard(page);
    const head = page.locator('#sec-writing .grouphead').first();
    const label = (await head.textContent()).replace(/[▾▸✎]/g, '').trim();
    await dragThenClick(page, '#sec-writing .grouphead');
    const folded = await page.evaluate((k) => !!(window.__dbg.state().subFolded || {})[k], `writing/${label}`);
    expect(folded).toBe(false);
  });

  test('drag-selecting a section heading does not fold the card', async ({ page }) => {
    await openBoard(page);
    await dragThenClick(page, '#sec-personal > h2');
    const folded = await page.evaluate(() => !!(window.__dbg.state().folded || {}).personal);
    expect(folded).toBe(false);
  });

  test('drag-selecting a row does not toggle it', async ({ page }) => {
    await openBoard(page);
    const text = uniq('just reading this');
    await addWeekTask(page, text);
    await dragThenClick(page, `${row(text)} .txt`);
    await expect(page.locator('.actmenu.selbar')).toHaveCount(0);
  });
});

test.describe('recurring tasks', () => {
  // Reach the repeat rules the way the UI does: select the row, open the menu.
  async function setRepeat(page, text, rule) {
    await page.locator(row(text)).click({ button: 'right' });
    await page.locator('.actmenu button[data-act="repeat"]').first().click();
    await page.locator(`.actmenu button[data-act="rep2"][data-rep="${rule}"]`).click();
  }
  const recurRow = (text) => `#list-recur li[data-id]:has(.txt:text-is("${text}"))`;

  test('a daily task moves into the Recurring strip below Tomorrow', async ({ page }) => {
    await openBoard(page);
    const text = uniq('answer new leads');
    await addWeekTask(page, text);
    await setRepeat(page, text, 'daily');
    await expect(page.locator('#recurWrap')).toBeVisible();
    await expect(page.locator(recurRow(text))).toHaveCount(1);
    await expect(page.locator(`${recurRow(text)} .rep`)).toHaveText('daily');
  });

  test('the strip sits below the Today and Tomorrow columns', async ({ page }) => {
    await openBoard(page);
    const day = uniq('something today'), text = uniq('placed below');
    await addWeekTask(page, day);
    await html5Drag(page, row(day), '#col-tdy');       // the columns only draw when in use
    await addWeekTask(page, text);
    await setRepeat(page, text, 'daily');
    await expect(page.locator('#daycols')).toBeVisible();
    const cols = await page.locator('#daycols').boundingBox();
    const strip = await page.locator('#recurWrap').boundingBox();
    expect(strip.y).toBeGreaterThan(cols.y + cols.height - 1);
  });

  test('ticking one marks it done for today, it is not archived', async ({ page }) => {
    await openBoard(page);
    const text = uniq('30 min of writing');
    await addWeekTask(page, text);
    await setRepeat(page, text, 'daily');
    await page.locator(`${recurRow(text)} .box`).click();
    await expect(page.locator(recurRow(text))).toHaveClass(/done/);
    const t = await page.evaluate((x) => window.__dbg.state().tasks.find((t) => t.text === x), text);
    expect(t.status).not.toBe('done');
    expect(t.status).not.toBe('archived');
    expect(t.lastDone).toBeTruthy();
    await expect(page.locator(recurRow(text))).toHaveCount(1);   // still on the board
  });

  test('ticking it again unticks it', async ({ page }) => {
    await openBoard(page);
    const text = uniq('untick me');
    await addWeekTask(page, text);
    await setRepeat(page, text, 'daily');
    await page.locator(`${recurRow(text)} .box`).click();
    await expect(page.locator(recurRow(text))).toHaveClass(/done/);
    await page.locator(`${recurRow(text)} .box`).click();
    await expect(page.locator(recurRow(text))).not.toHaveClass(/done/);
  });

  test('yesterday’s tick does not carry into today', async ({ page }) => {
    await openBoard(page);
    const text = uniq('fresh each day');
    await addWeekTask(page, text);
    await setRepeat(page, text, 'daily');
    await page.evaluate((x) => {
      const t = window.__dbg.state().tasks.find((t) => t.text === x);
      const y = new Date(); y.setDate(y.getDate() - 1);
      t.lastDone = y.toDateString();
      window.__dbg.syncRender();
    }, text);
    await expect(page.locator(recurRow(text))).not.toHaveClass(/done/);
  });

  test('a weekly rule is only due on its own day', async ({ page }) => {
    await openBoard(page);
    const text = uniq('weekly export');
    await addWeekTask(page, text);
    await setRepeat(page, text, 'weekly');
    const t = await page.evaluate((x) => window.__dbg.state().tasks.find((t) => t.text === x), text);
    expect(t.repeat).toBe('weekly');
    expect(t.repeatDay).toBe(new Date().getDay());   // set to the day you asked on
    await expect(page.locator(recurRow(text))).toHaveClass(/duetoday/);
    await page.evaluate((x) => {
      const t = window.__dbg.state().tasks.find((t) => t.text === x);
      t.repeatDay = (new Date().getDay() + 3) % 7;
      window.__dbg.syncRender();
    }, text);
    await expect(page.locator(recurRow(text))).toHaveClass(/notdue/);
  });

  test('a monthly rule remembers the day of the month', async ({ page }) => {
    await openBoard(page);
    const text = uniq('monthly report');
    await addWeekTask(page, text);
    await setRepeat(page, text, 'monthly');
    const t = await page.evaluate((x) => window.__dbg.state().tasks.find((t) => t.text === x), text);
    expect(t.repeatDom).toBe(new Date().getDate());
  });

  test('the count says how many are still due', async ({ page }) => {
    await openBoard(page);
    const a = uniq('routine one'), b = uniq('routine two');
    await addWeekTask(page, a);
    await addWeekTask(page, b);
    await setRepeat(page, a, 'daily');
    await setRepeat(page, b, 'daily');
    await expect(page.locator('#recN')).toHaveText('2 due today');
    await page.locator(`${recurRow(a)} .box`).click();
    await expect(page.locator('#recN')).toHaveText('1 due today');
    await page.locator(`${recurRow(b)} .box`).click();
    await expect(page.locator('#recN')).toHaveText('all done today');
  });

  test('a repeating task is not also listed in the week', async ({ page }) => {
    await openBoard(page);
    const text = uniq('only once');
    await addWeekTask(page, text);
    await setRepeat(page, text, 'daily');
    await expect(page.locator(`#list-week li[data-id]`).filter({ hasText: text })).toHaveCount(0);
    await expect(page.locator(`#list-today li[data-id]`).filter({ hasText: text })).toHaveCount(0);
  });

  test('turning the repeat off puts it back', async ({ page }) => {
    await openBoard(page);
    const text = uniq('no longer daily');
    await addWeekTask(page, text);
    await setRepeat(page, text, 'daily');
    await expect(page.locator(recurRow(text))).toHaveCount(1);
    await setRepeat(page, text, 'none');
    await expect(page.locator(recurRow(text))).toHaveCount(0);
    const t = await page.evaluate((x) => window.__dbg.state().tasks.find((t) => t.text === x), text);
    expect(t.repeat).toBeUndefined();
  });

  test('the strip is hidden when nothing repeats', async ({ page }) => {
    await openBoard(page);
    await expect(page.locator('#recurWrap')).toBeHidden();
  });
});

test.describe('this month', () => {
  const monthRow = (text) => `#list-month li[data-id]:has(.txt:text-is("${text}"))`;

  test('the menu pins a task to This month', async ({ page }) => {
    await openBoard(page);
    const text = uniq('next month job');
    await addWeekTask(page, text);
    await page.locator(row(text)).click({ button: 'right' });
    await page.locator('.actmenu button[data-act="month"]').first().click();
    await expect(page.locator('#monthWrap')).toBeVisible();
    await expect(page.locator(monthRow(text))).toHaveCount(1);
    await expect(page.locator('#monN')).toHaveText('1');
  });

  test('This month sits below Tomorrow and below the week list', async ({ page }) => {
    await openBoard(page);
    const day = uniq('something today'), text = uniq('later job');
    await addWeekTask(page, day);
    await html5Drag(page, row(day), '#col-tdy');       // the columns only draw when in use
    await addWeekTask(page, text);
    await page.locator(row(text)).click({ button: 'right' });
    await page.locator('.actmenu button[data-act="month"]').first().click();
    await expect(page.locator('#daycols')).toBeVisible();
    const cols = await page.locator('#daycols').boundingBox();
    const week = await page.locator('#list-week').boundingBox();
    const mon = await page.locator('#monthWrap').boundingBox();
    expect(mon.y).toBeGreaterThan(cols.y + cols.height - 1);
    expect(mon.y).toBeGreaterThanOrEqual(week.y);
  });

  test('dropping a task on This month pins it there', async ({ page }) => {
    await openBoard(page);
    const seed = uniq('already monthly'), text = uniq('dragged in');
    await addWeekTask(page, seed);
    await page.locator(row(seed)).click({ button: 'right' });
    await page.locator('.actmenu button[data-act="month"]').first().click();
    await expect(page.locator('#monthWrap')).toBeVisible();
    await addWeekTask(page, text);
    await html5Drag(page, row(text), '#monthWrap');
    const t = await page.evaluate((x) => window.__dbg.state().tasks.find((t) => t.text === x), text);
    expect(t.month).toBe(true);
  });

  test('a month task is not also listed in the week', async ({ page }) => {
    await openBoard(page);
    const text = uniq('one place only');
    await addWeekTask(page, text);
    await page.locator(row(text)).click({ button: 'right' });
    await page.locator('.actmenu button[data-act="month"]').first().click();
    await expect(page.locator(monthRow(text))).toHaveCount(1);
    await expect(page.locator('#list-week li[data-id]').filter({ hasText: text })).toHaveCount(0);
  });

  test('unpinning removes it and hides the block', async ({ page }) => {
    await openBoard(page);
    const text = uniq('off the month');
    await addWeekTask(page, text);
    await page.locator(row(text)).click({ button: 'right' });
    await page.locator('.actmenu button[data-act="month"]').first().click();
    await expect(page.locator(monthRow(text))).toHaveCount(1);
    await page.locator(monthRow(text)).click({ button: 'right' });
    await page.locator('.actmenu button[data-act="month"]').first().click();
    await expect(page.locator('#monthWrap')).toBeHidden();
  });

  test('the block is hidden when nothing is pinned to it', async ({ page }) => {
    await openBoard(page);
    await expect(page.locator('#monthWrap')).toBeHidden();
  });
});

test.describe('when this system last changed', () => {
  test('the stat line carries the build time before the manuscript link', async ({ page }) => {
    await openBoard(page);
    const stamp = await page.locator('#buildstamp').textContent();
    const m = stamp.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}:\d{2})/);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const expected = `updated ${months[+m[2] - 1]} ${+m[3]}, ${m[4]} UTC`;
    await expect(page.locator('#statline .statbuilt')).toHaveText(expected);
  });

  test('it reads off the build stamp, so it cannot drift', async ({ page }) => {
    await openBoard(page);
    await page.evaluate(() => {
      document.getElementById('buildstamp').textContent = 'build 2031-12-25 07:09 UTC';
      window.__dbg.syncRender();
    });
    await expect(page.locator('#statline .statbuilt')).toHaveText('updated Dec 25, 07:09 UTC');
  });

  test('it comes before the manuscript link, not after', async ({ page }) => {
    await openBoard(page);
    const text = await page.locator('#statline').innerText();
    expect(text.indexOf('updated')).toBeGreaterThan(-1);
    expect(text.indexOf('updated')).toBeLessThan(text.indexOf('Manuscript system'));
  });
});

test.describe('phone layout', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('switches to the phone shell', async ({ page }) => {
    await openBoard(page);
    await expect(page.locator('body')).toHaveClass(/phone/);
    await expect(page.locator('#mnav')).toBeVisible();
    await expect(page.locator('.app')).toBeHidden();
  });

  test('the bottom tabs switch views', async ({ page }) => {
    await openBoard(page);
    await page.locator('#mnav button[data-mtab="board"]').click();
    await expect(page.locator('.msec').first()).toBeVisible();
    await page.locator('#mnav button[data-mtab="done"]').click();
    await expect(page.locator('.mgroup').first()).toContainText('Done');
  });

  test('the add sheet creates a task', async ({ page }) => {
    await openBoard(page);
    await page.locator('#mfab').click();
    await expect(page.locator('#msheet')).toHaveClass(/on/);
    await page.locator('#mnewtext').fill('phone task');
    await page.locator('[data-mact="create"]').click();
    await expect(page.locator('#msheet')).not.toHaveClass(/on/);
    const t = await page.evaluate(() => window.__dbg.state().tasks.find((t) => t.text === 'phone task'));
    expect(t.week).toBe(true);
  });

  test('tapping a row opens its action sheet', async ({ page }) => {
    await openBoard(page);
    await page.locator('#mnav button[data-mtab="week"]').click();
    await page.locator('.mrow').first().click();
    await expect(page.locator('#msheet')).toHaveClass(/on/);
    await expect(page.locator('[data-mact="done"]')).toBeVisible();
  });
});
