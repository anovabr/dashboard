const { test, expect } = require('@playwright/test');
const { openMs, html5Drag, dragThenClick, iso } = require('./helpers');

const paper = (over = {}) => ({
  id: 'p1', title: 'A paper about things', type: 'manuscript', project: 'ASQ',
  journal: 'Journal of Things', authors: 'Surname, A.', status: 'under review',
  submitted: '2026-01-10', lastUpdate: '2026-06-01', notes: '', updates: [], attempts: [],
  createdAt: iso(200), updatedAt: iso(30), ...over,
});

test.describe('password gate', () => {
  test('locks the tracker when no password is stored', async ({ page }) => {
    await openMs(page, { locked: true });
    await expect(page.locator('#gate')).toHaveClass(/on/);
  });

  test('with no local encrypted blob, any password lets the sync decide', async ({ page }) => {
    await openMs(page, { locked: true });
    await page.locator('#gatepw').fill('hunter2');
    await page.locator('#gatego').click();
    await expect(page.locator('#gate')).not.toHaveClass(/on/);
    expect(await page.evaluate(() => localStorage.getItem('task-board-pw'))).toBe('hunter2');
  });

  test('a wrong password does not open a locked board', async ({ page }) => {
    // "exit" leaves an encrypted copy behind under manuscript-crm-v1e; the gate
    // checks against it, so a bad password must be rejected locally.
    await openMs(page, { papers: [paper()] });
    await page.locator('#lockBtn').click();
    await page.waitForFunction(() => !!localStorage.getItem('manuscript-crm-v1e'));
    await expect(page.locator('#gate')).toHaveClass(/on/);
    await page.locator('#gatepw').fill('definitely-wrong');
    await page.locator('#gatego').click();
    await expect(page.locator('#gateerr')).toHaveText('That password does not open this board.');
    await expect(page.locator('#gate')).toHaveClass(/on/);
  });

  test('the right password reopens the board it locked', async ({ page }) => {
    await openMs(page, { papers: [paper()] });
    await page.locator('#lockBtn').click();
    await page.waitForFunction(() => !!localStorage.getItem('manuscript-crm-v1e'));
    await page.locator('#gatepw').fill('test-password');
    await page.locator('#gatego').click();
    await expect(page.locator('#gate')).not.toHaveClass(/on/);
    await expect(page.locator('tr[data-id]')).toHaveCount(1);
  });

  test('exit removes the plaintext copy', async ({ page }) => {
    await openMs(page, { papers: [paper()] });
    await page.locator('#lockBtn').click();
    await expect(page.locator('#gate')).toHaveClass(/on/);   // exit reloads; wait for the new page
    const keys = await page.evaluate(() => ({
      plain: localStorage.getItem('manuscript-crm-v1'),
      encrypted: localStorage.getItem('manuscript-crm-v1e'),
    }));
    expect(keys.plain).toBeNull();
    expect(keys.encrypted).not.toBeNull();
  });
});

test.describe('add, edit, delete', () => {
  test('adds a paper', async ({ page }) => {
    await openMs(page);
    await page.locator('#newBtn').click();
    await expect(page.locator('#modal')).toHaveClass(/on/);
    await page.locator('#f-title').fill('Brand new manuscript');
    await page.locator('#mSave').click();
    await expect(page.locator('#modal')).not.toHaveClass(/on/);
    await expect(page.locator('tr[data-id]').filter({ hasText: 'Brand new manuscript' })).toHaveCount(1);
  });

  test('refuses to save without a title', async ({ page }) => {
    await openMs(page);
    await page.locator('#newBtn').click();
    await page.locator('#mSave').click();
    await expect(page.locator('#modal')).toHaveClass(/on/);
    await expect(page.locator('.toast')).toHaveText('A title is required');
  });

  test('the row pencil opens the record for editing', async ({ page }) => {
    await openMs(page, { papers: [paper()] });
    await page.locator('.rowedit').click();
    await expect(page.locator('#modal')).toHaveClass(/on/);
    await expect(page.locator('#f-title')).toHaveValue('A paper about things');
  });

  test('saves an edit back to the row', async ({ page }) => {
    await openMs(page, { papers: [paper()] });
    await page.locator('.rowedit').click();
    await page.locator('#f-title').fill('A renamed paper');
    await page.locator('#mSave').click();
    await expect(page.locator('tr[data-id]')).toContainText('A renamed paper');
  });

  test('deleting moves the paper to the trash, not out of existence', async ({ page }) => {
    await openMs(page, { papers: [paper()] });
    await page.locator('.rowedit').click();
    await page.locator('#mDel').click();
    await expect(page.locator('tr[data-id]')).toHaveCount(0);
    const state = await page.evaluate(() => window.__ms.state().papers);
    expect(state).toHaveLength(1);
    expect(state[0].deleted).toBe(true);
  });

  test('the trash restores a deleted paper', async ({ page }) => {
    await openMs(page, { papers: [paper()] });
    await page.locator('.rowedit').click();
    await page.locator('#mDel').click();
    await page.locator('#trashBtn').click();
    await page.locator('[data-restore]').click();
    await expect(page.locator('#audit')).toContainText('The trash is empty.');
    await page.locator('#aClose').click();
    await expect(page.locator('tr[data-id]')).toHaveCount(1);
  });

  test('Ctrl+Z undoes a delete', async ({ page }) => {
    await openMs(page, { papers: [paper()] });
    await page.locator('.rowedit').click();
    await page.locator('#mDel').click();
    await expect(page.locator('tr[data-id]')).toHaveCount(0);
    await page.keyboard.press('Control+z');
    await expect(page.locator('tr[data-id]')).toHaveCount(1);
  });

  test('records a submission attempt', async ({ page }) => {
    await openMs(page, { papers: [paper()] });
    await page.locator('.rowedit').click();
    await page.locator('#attAdd').click();
    await expect(page.locator('#att .attrow')).toHaveCount(2);
    const fresh = page.locator('#att .attrow').nth(1);
    await fresh.locator('[data-af="journal"]').fill('Second Journal');
    await fresh.locator('[data-af="submitted"]').fill('2026-03-04');
    await page.locator('#mSave').click();
    const p = await page.evaluate(() => window.__ms.state().papers[0]);
    expect(p.attempts).toHaveLength(2);
    expect(p.journal).toBe('Second Journal'); // the mirror follows the latest attempt
  });

  test('adds a dated history entry', async ({ page }) => {
    await openMs(page, { papers: [paper()] });
    await page.locator('.rowedit').click();
    await page.locator('#u-date').fill('2026-04-02');
    await page.locator('#u-text').fill('reviews came back');
    await page.locator('#u-add').click();
    await expect(page.locator('#tl .tlrow')).toHaveCount(1);
    await page.locator('#mSave').click();
    const p = await page.evaluate(() => window.__ms.state().papers[0]);
    expect(p.updates).toEqual([{ d: '2026-04-02', t: 'reviews came back' }]);
  });
});

test.describe('rejected, then sent to another journal', () => {
  const pending = (o = {}) => paper({
    journal: 'Journal of Things', status: 'under review',
    attempts: [{ id: 'a1', journal: 'Journal of Things', submitted: '2026-01-10',
      msid: 'MS-4471', decision: '', decisionDate: '' }], ...o,
  });

  test('an attempt is edited in place and stays in the list', async ({ page }) => {
    await openMs(page, { papers: [pending()] });
    await page.locator('.rowedit').click();
    const first = page.locator('#att .attrow').first();
    await first.locator('[data-af="decision"]').selectOption('rejected');
    await first.locator('[data-af="decisionDate"]').fill('2026-04-02');
    await expect(page.locator('#att .attrow')).toHaveCount(1);   // editing never removes the row
    await page.locator('#mSave').click();
    const p = await page.evaluate(() => window.__ms.state().papers[0]);
    expect(p.attempts).toHaveLength(1);
    expect(p.attempts[0].decision).toBe('rejected');
    expect(p.attempts[0].decisionDate).toBe('2026-04-02');
    expect(p.attempts[0].msid).toBe('MS-4471');                  // untouched fields survive
  });

  test('one action closes the old attempt and opens the new one', async ({ page }) => {
    await openMs(page, { papers: [pending()] });
    await page.locator('.rowedit').click();
    await page.locator('#attResub').click();
    await page.locator('#r-journal').fill('Second Journal');
    await page.locator('#r-date').fill('2026-04-15');
    await page.locator('#r-go').click();

    await expect(page.locator('#att .attrow')).toHaveCount(2);
    await expect(page.locator('#f-status')).toHaveValue('submitted');
    await page.locator('#mSave').click();

    const p = await page.evaluate(() => window.__ms.state().papers[0]);
    expect(p.attempts[0].decision).toBe('rejected');
    expect(p.attempts[0].decisionDate).toBeTruthy();
    expect(p.attempts[1]).toMatchObject({ journal: 'Second Journal', submitted: '2026-04-15', decision: '' });
    expect(p.status).toBe('submitted');
    expect(p.journal).toBe('Second Journal');                    // the mirror follows the latest attempt
    const line = p.updates.find((u) => /Resubmitted to Second Journal/.test(u.t));
    expect(line).toBeTruthy();
    expect(line.t).toContain('Journal of Things');
    expect(line.d).toBe('2026-04-15');
  });

  test('the history line it writes is editable afterwards', async ({ page }) => {
    await openMs(page, { papers: [pending()] });
    await page.locator('.rowedit').click();
    await page.locator('#attResub').click();
    await page.locator('#r-journal').fill('Second Journal');
    await page.locator('#r-go').click();
    await expect(page.locator('#tl .tlrow')).toHaveCount(1);
    await page.locator('#tl [data-utxt="0"]').fill('my own wording');
    await page.locator('#mSave').click();
    const p = await page.evaluate(() => window.__ms.state().papers[0]);
    expect(p.updates[0].t).toBe('my own wording');
  });

  test('it defaults the dates to today when they are left blank', async ({ page }) => {
    await openMs(page, { papers: [pending()] });
    await page.locator('.rowedit').click();
    await page.locator('#attResub').click();
    await page.locator('#r-journal').fill('Second Journal');
    await page.locator('#r-go').click();
    await page.locator('#mSave').click();
    const today = new Date().toISOString().slice(0, 10);
    const p = await page.evaluate(() => window.__ms.state().papers[0]);
    expect(p.attempts[0].decisionDate).toBe(today);
    expect(p.attempts[1].submitted).toBe(today);
  });

  test('a decision already on record is not overwritten', async ({ page }) => {
    await openMs(page, { papers: [pending({ attempts: [{ id: 'a1', journal: 'Journal of Things',
      submitted: '2026-01-10', decision: 'desk reject', decisionDate: '2026-01-20' }] })] });
    await page.locator('.rowedit').click();
    await page.locator('#attResub').click();
    await page.locator('#r-journal').fill('Second Journal');
    await page.locator('#r-go').click();
    await page.locator('#mSave').click();
    const p = await page.evaluate(() => window.__ms.state().papers[0]);
    expect(p.attempts[0].decision).toBe('desk reject');
    expect(p.attempts[0].decisionDate).toBe('2026-01-20');
  });

  test('it will not send the paper nowhere', async ({ page }) => {
    await openMs(page, { papers: [pending()] });
    await page.locator('.rowedit').click();
    await page.locator('#attResub').click();
    await page.locator('#r-go').click();
    await expect(page.locator('.toast')).toContainText('Which journal');
    await expect(page.locator('#att .attrow')).toHaveCount(1);
  });

  test('cancelling it changes nothing', async ({ page }) => {
    await openMs(page, { papers: [pending()] });
    await page.locator('.rowedit').click();
    await page.locator('#attResub').click();
    await page.locator('#r-journal').fill('Second Journal');
    await page.locator('#r-cancel').click();
    await expect(page.locator('#resubBox')).not.toHaveClass(/on/);
    await expect(page.locator('#att .attrow')).toHaveCount(1);
    await expect(page.locator('#f-status')).toHaveValue('under review');
  });

  test('the action is offered only once the paper has been somewhere', async ({ page }) => {
    await openMs(page);
    await page.locator('#newBtn').click();
    await expect(page.locator('#attResub')).toBeHidden();
    await page.locator('#attAdd').click();
    await page.locator('#att .attrow [data-af="journal"]').fill('First Journal');
    await expect(page.locator('#attResub')).toBeVisible();
  });

  test('an attempt row left blank is not saved', async ({ page }) => {
    await openMs(page, { papers: [pending()] });
    await page.locator('.rowedit').click();
    await page.locator('#attAdd').click();
    await expect(page.locator('#att .attrow')).toHaveCount(2);
    await page.locator('#mSave').click();
    const p = await page.evaluate(() => window.__ms.state().papers[0]);
    expect(p.attempts).toHaveLength(1);
  });

  test('the row still removes an attempt outright', async ({ page }) => {
    await openMs(page, { papers: [pending()] });
    await page.locator('.rowedit').click();
    await page.locator('#att [data-attrm="0"]').click();
    await expect(page.locator('#att .attrow')).toHaveCount(0);
    await page.locator('#mSave').click();
    const p = await page.evaluate(() => window.__ms.state().papers[0]);
    expect(p.attempts).toHaveLength(0);
  });

  test('the whole story reads back in the row detail', async ({ page }) => {
    await openMs(page, { papers: [pending()] });
    await page.locator('.rowedit').click();
    await page.locator('#attResub').click();
    await page.locator('#r-journal').fill('Second Journal');
    await page.locator('#r-date').fill('2026-04-15');
    await page.locator('#r-go').click();
    await page.locator('#mSave').click();
    await page.locator('td.c-title').click();
    const detail = page.locator('tr.detail');
    await expect(detail).toContainText('Journal of Things');
    await expect(detail).toContainText('rejected');
    await expect(detail).toContainText('Second Journal');
    await expect(detail).toContainText('1 resubmission');
  });
});

test.describe('records imported from the old Flask CRM', () => {
  // Ids arrive as numbers (12), the DOM always hands them back as strings
  // ("12"). Any lookup that compares with === finds nothing and does nothing.
  test('a numeric id still opens for editing', async ({ page }) => {
    await openMs(page, { papers: [paper({ id: 12, title: 'Legacy numeric record' })] });
    await page.locator('.rowedit').click();
    await expect(page.locator('#modal')).toHaveClass(/on/);
    await expect(page.locator('#f-title')).toHaveValue('Legacy numeric record');
  });

  test('a numeric id can be deleted from the row detail', async ({ page }) => {
    await openMs(page, { papers: [paper({ id: 12 })] });
    await page.locator('tr[data-id]').click();
    await page.locator('[data-del]').click();
    const state = await page.evaluate(() => window.__ms.state().papers);
    expect(state[0].deleted).toBe(true);
  });

  test('a numeric id survives a board drag', async ({ page }) => {
    await openMs(page, { papers: [paper({ id: 12 })], state: null });
    await page.locator('#vBoard').click();
    await html5Drag(page, '.bcard[data-id]', '.bcol[data-status="accepted"]');
    const p = await page.evaluate(() => window.__ms.state().papers[0]);
    expect(p.status).toBe('accepted');
  });

  test('duplicate ids do not collapse into one record', async ({ page }) => {
    await openMs(page, { papers: [paper({ id: 12, title: 'First' }), paper({ id: 12, title: 'Second' })] });
    await expect(page.locator('tr[data-id]')).toHaveCount(2);
    await page.locator('tr[data-id]').filter({ hasText: 'Second' }).locator('.rowedit').click();
    await expect(page.locator('#f-title')).toHaveValue('Second');
  });
});

test.describe('malformed records must not freeze the page', () => {
  test('a null inside updates still renders', async ({ page }) => {
    await openMs(page, { papers: [paper({ updates: [null, { d: '2026-02-02', t: 'real entry' }, null] })] });
    await page.locator('tr[data-id]').click();
    await expect(page.locator('tr.detail')).toBeVisible();
    await expect(page.locator('tr.detail')).toContainText('real entry');
    const p = await page.evaluate(() => window.__ms.state().papers[0]);
    expect(p.updates).toHaveLength(1); // repaired once, at load
  });

  test('a null inside attempts still renders', async ({ page }) => {
    await openMs(page, { papers: [paper({ attempts: [null, { id: 'a1', journal: 'Real Journal', submitted: '2026-01-01' }] })] });
    await page.locator('tr[data-id]').click();
    await expect(page.locator('tr.detail')).toContainText('Real Journal');
  });

  test('a malformed record does not stop the rest of the table rendering', async ({ page }) => {
    await openMs(page, { papers: [
      paper({ id: 'bad', title: 'Broken one', updates: [null], attempts: [null] }),
      paper({ id: 'good', title: 'Healthy one' }),
    ] });
    await expect(page.locator('tr[data-id]')).toHaveCount(2);
    await expect(page.locator('tbody')).toContainText('Healthy one');
  });
});

test.describe('table and board', () => {
  test('a row expands into its detail and collapses again', async ({ page }) => {
    await openMs(page, { papers: [paper()] });
    await page.locator('tr[data-id]').click();
    await expect(page.locator('tr.detail')).toBeVisible();
    await page.locator('tr[data-id]').click();
    await expect(page.locator('tr.detail')).toHaveCount(0);
  });

  test('a column header sorts and flips direction', async ({ page }) => {
    await openMs(page, { papers: [paper({ id: 'a', title: 'Zebra' }), paper({ id: 'b', title: 'Alpha' })] });
    await page.locator('th[data-col="title"]').click();
    await expect(page.locator('tbody tr').first()).toContainText('Alpha');
    await page.locator('th[data-col="title"]').click();
    await expect(page.locator('tbody tr').first()).toContainText('Zebra');
  });

  test('search filters the table', async ({ page }) => {
    await openMs(page, { papers: [paper({ id: 'a', title: 'Zebra study' }), paper({ id: 'b', title: 'Alpha study' })] });
    await page.locator('#q').fill('zebra');
    await expect(page.locator('tr[data-id]')).toHaveCount(1);
  });

  test('dragging a card between board columns changes the status and logs it', async ({ page }) => {
    await openMs(page, { papers: [paper()] });
    await page.locator('#vBoard').click();
    await expect(page.locator('.bcard')).toHaveCount(1);
    await html5Drag(page, '.bcard[data-id]', '.bcol[data-status="accepted"]');
    const p = await page.evaluate(() => window.__ms.state().papers[0]);
    expect(p.status).toBe('accepted');
    expect(p.updates.at(-1).t).toContain('under review → accepted');
  });

  test('clicking a board card opens it', async ({ page }) => {
    await openMs(page, { papers: [paper()] });
    await page.locator('#vBoard').click();
    await page.locator('.bcard').click();
    await expect(page.locator('#modal')).toHaveClass(/on/);
  });

  test('"hide finished" drops published and rejected papers', async ({ page }) => {
    await openMs(page, { papers: [paper({ id: 'a', status: 'published' }), paper({ id: 'b', status: 'under review' })] });
    await expect(page.locator('tr[data-id]')).toHaveCount(2);
    await page.locator('#hideFin').click();
    await expect(page.locator('tr[data-id]')).toHaveCount(1);
  });
});

test.describe('import', () => {
  const upload = async (page, obj, name = 'import.json') =>
    page.locator('#impFile').setInputFiles({
      name, mimeType: 'application/json',
      buffer: Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)),
    });

  test('shows a preview before changing anything', async ({ page }) => {
    await openMs(page, { papers: [paper()] });
    await upload(page, { papers: [{ id: 'p2', title: 'Incoming paper', status: 'submitted' }] });
    await expect(page.locator('#audit')).toContainText('Import preview');
    await expect(page.locator('#audit')).toContainText('1 new papers');
    await expect(page.locator('tr[data-id]')).toHaveCount(1); // nothing applied yet
  });

  test('cancelling the preview changes nothing', async ({ page }) => {
    await openMs(page, { papers: [paper()] });
    await upload(page, { papers: [{ id: 'p2', title: 'Incoming paper' }] });
    await page.locator('#iCancel').click();
    await expect(page.locator('.toast')).toContainText('Import cancelled');
    await expect(page.locator('tr[data-id]')).toHaveCount(1);
  });

  test('applying the preview adds the new papers', async ({ page }) => {
    await openMs(page, { papers: [paper()] });
    await upload(page, { papers: [{ id: 'p2', title: 'Incoming paper', status: 'submitted' }] });
    await page.locator('#iApply').click();
    await expect(page.locator('tr[data-id]')).toHaveCount(2);
    await expect(page.locator('.tablewrap tbody')).toContainText('Incoming paper');
  });

  test('an empty incoming value never blanks a field that has one', async ({ page }) => {
    await openMs(page, { papers: [paper()] });
    await upload(page, { papers: [{ id: 'p1', title: 'A paper about things', journal: '', authors: '', notes: '' }] });
    await expect(page.locator('#audit')).toContainText('empty incoming values ignored');
    await page.locator('#iApply').click();
    const p = await page.evaluate(() => window.__ms.state().papers[0]);
    expect(p.journal).toBe('Journal of Things');
    expect(p.authors).toBe('Surname, A.');
  });

  test('a deleted paper is never resurrected by an import', async ({ page }) => {
    await openMs(page, { papers: [paper({ deleted: true })] });
    await upload(page, { papers: [{ id: 'p1', title: 'A paper about things', status: 'under review' }] });
    await expect(page.locator('#audit')).toContainText('left in the trash');
    await page.locator('#iApply').click();
    await expect(page.locator('tr[data-id]')).toHaveCount(0);
    const p = await page.evaluate(() => window.__ms.state().papers[0]);
    expect(p.deleted).toBe(true);
  });

  test('an incoming tombstone is not added as a new paper', async ({ page }) => {
    await openMs(page);
    await upload(page, { papers: [{ id: 'ghost', title: 'Deleted elsewhere', deleted: true }] });
    await expect(page.locator('#audit')).toContainText('0 new papers');
  });

  test('imports a CSV and maps its columns', async ({ page }) => {
    await openMs(page);
    await upload(page,
      'Title,Journal,Status,Date Submitted\nCSV paper,Nature,submitted,2026-02-01\n', 'old-crm.csv');
    await expect(page.locator('#audit')).toContainText('Import preview');
    await page.locator('#iApply').click();
    const p = await page.evaluate(() => window.__ms.state().papers[0]);
    expect(p.title).toBe('CSV paper');
    expect(p.journal).toBe('Nature');
    expect(p.submitted).toBe('2026-02-01');
  });

  test('ids arriving as numbers are usable after the import', async ({ page }) => {
    await openMs(page);
    await upload(page, { papers: [{ id: 7, title: 'Numeric id from the old CRM', status: 'submitted' }] });
    await page.locator('#iApply').click();
    await page.locator('#aClose').click().catch(() => {});
    await page.locator('.rowedit').click();
    await expect(page.locator('#modal')).toHaveClass(/on/);
    await expect(page.locator('#f-title')).toHaveValue('Numeric id from the old CRM');
  });

  const csvUpload = async (page, csv) =>
    page.locator('#impFile').setInputFiles({ name: 'old-crm.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });

  test('reads a last-update column written in Portuguese', async ({ page }) => {
    await openMs(page);
    await csvUpload(page, 'Title,Status,Última atualização\nSuicide across countries,writing,2025-11-14\n');
    await page.locator('#iApply').click();
    const p = await page.evaluate(() => window.__ms.state().papers[0]);
    expect(p.lastUpdate).toBe('2025-11-14');
  });

  test('reads the other ways that column gets named', async ({ page }) => {
    for (const header of ['Atualizado em', 'Ultima atualizacao', 'Last modified', 'Data da última alteração']) {
      await openMs(page);
      await csvUpload(page, `Title,Status,${header}\nA paper,writing,2025-11-14\n`);
      await page.locator('#iApply').click();
      const p = await page.evaluate(() => window.__ms.state().papers[0]);
      expect(p.lastUpdate, `header "${header}"`).toBe('2025-11-14');
    }
  });

  test('reads a submitted column written in Portuguese', async ({ page }) => {
    await openMs(page);
    await csvUpload(page, 'Title,Status,Data de submissão\nA paper,submitted,2025-03-09\n');
    await page.locator('#iApply').click();
    const p = await page.evaluate(() => window.__ms.state().papers[0]);
    expect(p.submitted).toBe('2025-03-09');
  });

  test('accented headers match their plain spelling', async ({ page }) => {
    await openMs(page);
    await csvUpload(page, 'Title,Situação,Projeto\nA paper,under review,ASQ\n');
    await page.locator('#iApply').click();
    const p = await page.evaluate(() => window.__ms.state().papers[0]);
    expect(p.status).toBe('under review');
    expect(p.project).toBe('ASQ');
  });

  test('with no last-update column, the date is left empty rather than invented', async ({ page }) => {
    await openMs(page);
    await csvUpload(page, 'Title,Status\nA paper,writing\n');
    await page.locator('#iApply').click();
    const p = await page.evaluate(() => window.__ms.state().papers[0]);
    expect(p.lastUpdate).toBe('');
    await expect(page.locator('td[data-l="last update"]').first()).toHaveText('—');
  });

  test('a stalled paper with no date is flagged, not passed off as fresh', async ({ page }) => {
    await openMs(page);
    await csvUpload(page, 'Title,Status\nA stalled paper,under review\n');
    await page.locator('#iApply').click();
    await page.locator('#aClose').click().catch(() => {});
    await expect(page.locator('.late')).toBeVisible();
  });

  test('a real date still beats the import time', async ({ page }) => {
    await openMs(page);
    await csvUpload(page, 'Title,Status,Last update\nA paper,under review,2025-11-14\n');
    await page.locator('#iApply').click();
    const p = await page.evaluate(() => window.__ms.state().papers[0]);
    expect(p.lastUpdate).toBe('2025-11-14');
  });

  test('the report opens itself when the last-update column found nothing', async ({ page }) => {
    await openMs(page);
    await csvUpload(page, 'Title,Journal,Status,Date Submitted,Nao usada\nA paper,Nature,submitted,2026-02-01,x\n');
    await page.locator('#iApply').click();
    await expect(page.locator('#audit')).toContainText('Import report');
    await expect(page.locator('#audit')).toContainText('no column matched');
    await expect(page.locator('#audit')).toContainText('nao usada');   // and names what went unread
  });

  test('a file with nothing usable in it is refused', async ({ page }) => {
    await openMs(page, { papers: [paper()] });
    await upload(page, { papers: [{ nothing: 'useful' }] });
    await expect(page.locator('.toast')).toContainText('Import failed');
    await expect(page.locator('tr[data-id]')).toHaveCount(1);
  });
});

test.describe('sync', () => {
  test('a newer remote record wins', async ({ page }) => {
    await openMs(page, { papers: [paper({ updatedAt: iso(5) })] });
    await page.evaluate(() => {
      window.__ms.merge({ papers: [{ id: 'p1', title: 'Renamed elsewhere',
        updatedAt: new Date().toISOString() }] });
    });
    expect(await page.evaluate(() => window.__ms.state().papers[0].title)).toBe('Renamed elsewhere');
  });

  test('an older remote record loses', async ({ page }) => {
    await openMs(page, { papers: [paper({ updatedAt: new Date().toISOString() })] });
    await page.evaluate((old) => {
      window.__ms.merge({ papers: [{ id: 'p1', title: 'Stale elsewhere', updatedAt: old }] });
    }, iso(9));
    expect(await page.evaluate(() => window.__ms.state().papers[0].title)).toBe('A paper about things');
  });

  test('edits on two devices since the last sync are flagged as a conflict', async ({ page }) => {
    // syncedAt is the shared base; both sides moved away from it.
    await openMs(page, { papers: [paper({ syncedAt: iso(10), updatedAt: iso(2), notes: 'my edit' })] });
    await page.evaluate((their) => {
      window.__ms.merge({ papers: [{ id: 'p1', title: 'A paper about things',
        notes: 'their edit', updatedAt: their }] });
    }, iso(1));
    const p = await page.evaluate(() => window.__ms.state().papers[0]);
    expect(p.notes).toBe('their edit');           // newest wins
    expect(p.conflicts).toHaveLength(1);          // the loser is kept
    expect(p.conflicts[0].dropped.notes).toBe('my edit');
  });

  test('the conflicts panel lists what was dropped', async ({ page }) => {
    await openMs(page, { papers: [paper({ syncedAt: iso(10), updatedAt: iso(2), notes: 'my edit' })] });
    await page.evaluate((their) => {
      window.__ms.merge({ papers: [{ id: 'p1', title: 'A paper about things',
        notes: 'their edit', updatedAt: their }] });
    }, iso(1));
    await page.evaluate(() => { document.getElementById('conflictBtn').style.display = ''; });
    await page.locator('#conflictBtn').click();
    await expect(page.locator('#audit')).toContainText('Edit conflicts');
    await expect(page.locator('#audit')).toContainText('my edit');
  });

  test('settings merge on their own clock', async ({ page }) => {
    await openMs(page, { papers: [], state: { papers: [], changelog: [], theme: 'auto',
      delayDays: 45, settingsAt: iso(5), sort: { col: 'lastUpdate', dir: -1 } } });
    await page.evaluate((now) => {
      window.__ms.merge({ papers: [], delayDays: 90, theme: 'dark', settingsAt: now });
    }, new Date().toISOString());
    expect(await page.evaluate(() => window.__ms.state().delayDays)).toBe(90);
  });

  test('older remote settings do not overwrite newer local ones', async ({ page }) => {
    await openMs(page, { papers: [], state: { papers: [], changelog: [], theme: 'auto',
      delayDays: 30, settingsAt: new Date().toISOString(), sort: { col: 'lastUpdate', dir: -1 } } });
    await page.evaluate((old) => {
      window.__ms.merge({ papers: [], delayDays: 90, settingsAt: old });
    }, iso(5));
    expect(await page.evaluate(() => window.__ms.state().delayDays)).toBe(30);
  });

  test('an unreadable remote file aborts the write instead of overwriting it', async ({ page }) => {
    const writes = await openMs(page, {
      papers: [paper()], token: 'ghp_faketoken', github: { mode: 'garbage' },
    });
    await page.locator('#syncBtn').click();
    await expect(page.locator('#syncBtn')).toHaveText('remote unreadable — not written');
    expect(writes).toHaveLength(0);
  });

  test('a readable remote merges and then writes back', async ({ page }) => {
    const writes = await openMs(page, {
      papers: [paper()], token: 'ghp_faketoken',
      github: { mode: 'state', remote: { papers: [{ id: 'p9', title: 'From the branch',
        status: 'submitted', updatedAt: new Date().toISOString() }] } },
    });
    await page.locator('#syncBtn').click();
    await expect(page.locator('tbody')).toContainText('From the branch');
    await expect.poll(() => writes.length).toBe(1);
  });
});

test.describe('data check and stats', () => {
  test('the data check reports gaps', async ({ page }) => {
    await openMs(page, { papers: [paper({ journal: '', attempts: [] })] });
    await page.locator('#auditBtn').click();
    await expect(page.locator('#audit')).toContainText('Data check');
    await expect(page.locator('#audit')).toContainText('No journal');
  });

  test('stats compute an acceptance rate from decided attempts', async ({ page }) => {
    await openMs(page, { papers: [paper({ attempts: [
      { id: 'a1', journal: 'J1', submitted: '2026-01-01', decision: 'accepted', decisionDate: '2026-03-01' },
      { id: 'a2', journal: 'J2', submitted: '2026-01-01', decision: 'rejected', decisionDate: '2026-02-01' },
    ] })] });
    await page.locator('#statsBtn').click();
    await expect(page.locator('#audit')).toContainText('Acceptance rate');
    await expect(page.locator('#audit')).toContainText('50%');
  });

  test('the CV list only includes published papers', async ({ page }) => {
    await openMs(page, { papers: [
      paper({ id: 'a', title: 'Published one', status: 'published', published: '2025-05-05' }),
      paper({ id: 'b', title: 'Unpublished one', status: 'under review' }),
    ] });
    await page.locator('#cvBtn').click();
    await expect(page.locator('#audit')).toContainText('Published one');
    await expect(page.locator('#audit')).not.toContainText('Unpublished one');
  });
});

test.describe('the self-healing overlay watchdog', () => {
  test('a scrim left on with no dialog open is cleared', async ({ page }) => {
    await openMs(page, { papers: [paper()] });
    await page.evaluate(() => document.getElementById('scrim').classList.add('on'));
    await expect(page.locator('#scrim')).not.toHaveClass(/on/, { timeout: 5000 });
  });

  test('Escape clears a stuck overlay immediately', async ({ page }) => {
    await openMs(page, { papers: [paper()] });
    await page.evaluate(() => document.getElementById('scrim').classList.add('on'));
    await page.keyboard.press('Escape');
    await expect(page.locator('#scrim')).not.toHaveClass(/on/);
  });

  test('the page still takes clicks after a stuck overlay clears', async ({ page }) => {
    await openMs(page, { papers: [paper()] });
    await page.evaluate(() => document.getElementById('scrim').classList.add('on'));
    await expect(page.locator('#scrim')).not.toHaveClass(/on/, { timeout: 5000 });
    await page.locator('.rowedit').click();
    await expect(page.locator('#modal')).toHaveClass(/on/);
  });
});

test.describe('drag-select must not be read as a click', () => {
  test('drag-selecting a row title does not expand the row', async ({ page }) => {
    await openMs(page, { papers: [paper()] });
    await dragThenClick(page, 'td.c-title');
    await expect(page.locator('tr.detail')).toHaveCount(0);
  });

  test('an ordinary click still expands the row', async ({ page }) => {
    await openMs(page, { papers: [paper()] });
    await page.locator('td.c-title').click();
    await expect(page.locator('tr.detail')).toBeVisible();
  });
});

test.describe('phone layout', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the table becomes cards', async ({ page }) => {
    await openMs(page, { papers: [paper()] });
    await expect(page.locator('thead')).toBeHidden();
    const display = await page.locator('tr[data-id]').evaluate((n) => getComputedStyle(n).display);
    expect(display).toBe('block');
  });

  test('the extra chips hide behind the ⋯ button', async ({ page }) => {
    await openMs(page, { papers: [paper()] });
    await expect(page.locator('#expBtn')).toBeHidden();
    await page.locator('#moreChips').click();
    await expect(page.locator('#expBtn')).toBeVisible();
  });

  test('a paper still opens for editing on a phone', async ({ page }) => {
    await openMs(page, { papers: [paper()] });
    await page.locator('.rowedit').click();
    await expect(page.locator('#modal')).toHaveClass(/on/);
    await expect(page.locator('#f-title')).toHaveValue('A paper about things');
  });
});
