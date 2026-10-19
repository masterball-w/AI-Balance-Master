const test = require('node:test');
const assert = require('node:assert/strict');
const { migrate, defaultData, mergeFromRenderer, sanitizeForRenderer, DATA_VERSION } = require('../lib/data');

const OLD_FAKE = JSON.stringify({
  platforms: [{ id: 'a', name: 'DeepSeek', balance: 86.4, unit: 'CNY', quota: { total: 45, used: 12, resetAt: '2026-01-01T00:00:00Z' }, expiryDate: '2026-12-01' }],
  settings: { petPosition: { x: 10, y: 20, width: 320, height: 460 } },
});

test('默认数据：没有任何余额/额度/日期数字', () => {
  const d = defaultData();
  assert.equal(d.version, DATA_VERSION);
  assert.ok(d.platforms.length >= 10);
  for (const p of d.platforms) {
    assert.equal(p.balance, null, p.name);
    assert.equal(p.quota, null, p.name);
    assert.equal(p.expiryDate, null, p.name);
    assert.equal(p.subscribeDate, null, p.name);
    assert.equal(p.fetch, null, p.name);
  }
});

test('迁移：无 version 的旧数据 → 清洁默认值，仅保留桌宠位置', () => {
  const r = migrate(OLD_FAKE);
  assert.equal(r.action, 'migrated-v1');
  assert.ok(r.data.platforms.every((p) => p.balance === null && p.quota === null));
  assert.deepEqual(r.data.settings.petPosition, { x: 10, y: 20, width: 320, height: 460 });
});

test('迁移：缺文件 / 损坏文件 / 新版本数据', () => {
  assert.equal(migrate(null).action, 'missing');
  assert.equal(migrate('{not json').action, 'corrupt');
  assert.equal(migrate('{"hello":1}').action, 'corrupt');
  const cur = defaultData();
  cur.platforms[0].balance = 12.5;
  const r = migrate(JSON.stringify(cur));
  assert.equal(r.action, 'ok');
  assert.equal(r.data.platforms[0].balance, 12.5);
});

test('合并：渲染进程不能改写 fetch 结果；provider 变化会清空旧结果', () => {
  const cur = defaultData();
  const ds = cur.platforms.find((p) => p.provider === 'deepseek');
  ds.fetch = { status: 'ok', balance: 99, unit: 'CNY', lastFetched: 'x' };
  const incoming = JSON.parse(JSON.stringify(cur));
  incoming.platforms.find((p) => p.id === ds.id).fetch = { status: 'ok', balance: 1e9 };
  incoming.platforms.find((p) => p.id === ds.id).apiKey = 'sk-leak';
  let m = mergeFromRenderer(cur, incoming, ['deepseek']);
  const mds = m.platforms.find((p) => p.id === ds.id);
  assert.equal(mds.fetch.balance, 99);
  assert.equal('apiKey' in mds, false);
  incoming.platforms.find((p) => p.id === ds.id).provider = '';
  m = mergeFromRenderer(cur, incoming, ['deepseek']);
  assert.equal(m.platforms.find((p) => p.id === ds.id).fetch, null);
});

test('发给渲染进程的数据不含密钥，只有 hasKey', () => {
  const d = defaultData();
  const s = sanitizeForRenderer(d, new Set([d.platforms[6].id]));
  assert.equal(s.platforms[6].hasKey, true);
  assert.equal(s.platforms[0].hasKey, false);
  assert.ok(!JSON.stringify(s).toLowerCase().includes('apikey'));
});
