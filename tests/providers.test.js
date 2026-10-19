// 运行：node --test tests/    （无需真实 Key、无需联网，fetch 全部为 mock）
const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchBalance, FetchError } = require('../lib/providers');

const okJson = (body) => async () => ({ ok: true, status: 200, json: async () => body });
const status = (code) => async () => ({ ok: false, status: code, json: async () => ({ error: { message: 'x' } }) });
const FAKE_KEY = 'test-key-not-real';

test('DeepSeek：解析多币种余额，CNY 优先', async () => {
  const r = await fetchBalance('deepseek', FAKE_KEY, { fetchImpl: okJson({
    is_available: true,
    balance_infos: [
      { currency: 'USD', total_balance: '2.50', granted_balance: '0.50', topped_up_balance: '2.00' },
      { currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' },
    ],
  }) });
  assert.equal(r.balance, 110);
  assert.equal(r.unit, 'CNY');
  assert.ok(r.details.some((d) => d.label === '充值余额' && d.value === '100 CNY'));
  assert.ok(r.details.some((d) => d.label.includes('USD')));
});

test('DeepSeek：余额不足标记；空 balance_infos 视为解析失败', async () => {
  const r = await fetchBalance('deepseek', FAKE_KEY, { fetchImpl: okJson({ is_available: false, balance_infos: [{ currency: 'CNY', total_balance: '0.00', granted_balance: '0.00', topped_up_balance: '0.00' }] }) });
  assert.equal(r.balance, 0);
  assert.ok(r.details.some((d) => d.value.includes('余额不足')));
  await assert.rejects(fetchBalance('deepseek', FAKE_KEY, { fetchImpl: okJson({ is_available: true, balance_infos: [] }) }), (e) => e.code === 'parse');
  await assert.rejects(fetchBalance('deepseek', FAKE_KEY, { fetchImpl: okJson({ hello: 1 }) }), (e) => e.code === 'parse');
});

test('Moonshot 国内/国际：币种不同，字段相同', async () => {
  const body = { code: 0, data: { available_balance: 49.58894, voucher_balance: 46.58893, cash_balance: 3.00001 }, scode: '0x0', status: true };
  const cn = await fetchBalance('moonshot-cn', FAKE_KEY, { fetchImpl: okJson(body) });
  const ai = await fetchBalance('moonshot-ai', FAKE_KEY, { fetchImpl: okJson(body) });
  assert.equal(cn.unit, 'CNY');
  assert.equal(ai.unit, 'USD');
  assert.equal(cn.balance, 49.5889);
  assert.ok(cn.details.some((d) => d.label === '代金券余额'));
  await assert.rejects(fetchBalance('moonshot-cn', FAKE_KEY, { fetchImpl: okJson({ code: 5, data: {} }) }), (e) => e.code === 'api' || e.code === 'parse');
});

test('SiliconFlow：使用 totalBalance，字符串转数字', async () => {
  const r = await fetchBalance('siliconflow', FAKE_KEY, { fetchImpl: okJson({ code: 20000, message: 'OK', status: true, data: { balance: '0.88', chargeBalance: '88.00', totalBalance: '88.88', status: 'normal' } }) });
  assert.equal(r.balance, 88.88);
  assert.equal(r.unit, 'CNY');
  await assert.rejects(fetchBalance('siliconflow', FAKE_KEY, { fetchImpl: okJson({ code: 20000, data: { balance: '1' } }) }), (e) => e.code === 'parse');
});

test('OpenRouter：余额 = total_credits - total_usage', async () => {
  const r = await fetchBalance('openrouter', FAKE_KEY, { fetchImpl: okJson({ data: { total_credits: 100.5, total_usage: 25.75 } }) });
  assert.equal(r.balance, 74.75);
  assert.equal(r.unit, 'USD');
  await assert.rejects(fetchBalance('openrouter', FAKE_KEY, { fetchImpl: okJson({ data: {} }) }), (e) => e.code === 'parse');
});

test('HTTP 错误映射：401 / 403 / 429 / 500，且错误信息不含 Key', async () => {
  for (const [code, kind] of [[401, 'auth'], [403, 'forbidden'], [429, 'rate'], [500, 'http']]) {
    await assert.rejects(fetchBalance('deepseek', FAKE_KEY, { fetchImpl: status(code) }), (e) => {
      assert.ok(e instanceof FetchError);
      assert.equal(e.code, kind);
      assert.ok(!e.message.includes(FAKE_KEY));
      return true;
    });
  }
  await assert.rejects(fetchBalance('openrouter', FAKE_KEY, { fetchImpl: status(403) }), (e) => e.message.includes('Management Key'));
});

test('网络错误 / 超时 / 非 JSON / 无 Key / 未知 provider', async () => {
  await assert.rejects(fetchBalance('deepseek', FAKE_KEY, { fetchImpl: async () => { throw new TypeError('fetch failed'); } }), (e) => e.code === 'network');
  await assert.rejects(fetchBalance('deepseek', FAKE_KEY, { timeoutMs: 20, fetchImpl: (url, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => { const err = new Error('aborted'); err.name = 'AbortError'; rej(err); })) }), (e) => e.code === 'timeout');
  await assert.rejects(fetchBalance('deepseek', FAKE_KEY, { fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } }) }), (e) => e.code === 'parse');
  await assert.rejects(fetchBalance('deepseek', '', { fetchImpl: okJson({}) }), (e) => e.code === 'nokey');
  await assert.rejects(fetchBalance('nope', FAKE_KEY, { fetchImpl: okJson({}) }), (e) => e.code === 'provider');
});

test('请求形态：GET + Bearer 头 + 官方端点', async () => {
  const seen = [];
  const spy = async (url, o) => { seen.push({ url, method: o.method, auth: o.headers.Authorization }); return { ok: true, status: 200, json: async () => ({ data: { total_credits: 1, total_usage: 0 } }) }; };
  await fetchBalance('openrouter', FAKE_KEY, { fetchImpl: spy });
  assert.deepEqual(seen[0], { url: 'https://openrouter.ai/api/v1/credits', method: 'GET', auth: `Bearer ${FAKE_KEY}` });
});
