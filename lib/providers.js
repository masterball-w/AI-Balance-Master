/**
 * 余额查询：仅包含「官方文档公开」的余额接口。
 * 每个 provider 都对照官方文档核对过端点与返回结构（文档链接见 docs 字段）。
 * 纯逻辑模块（不依赖 Electron），便于用 mock fetch 做单元测试。
 */

class FetchError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** 把任意值安全地转成有限数字，失败返回 null（绝不编造数字） */
function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}
const round = (n, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

const PROVIDERS = {
  deepseek: {
    label: 'DeepSeek（API 余额）',
    url: 'https://api.deepseek.com/user/balance',
    currencyHint: 'CNY / USD',
    docs: 'https://api-docs.deepseek.com/api/get-user-balance',
    keyHint: '平台 API Key（sk-…），仅需能访问余额接口',
    /** 返回 { balance, unit, details[] } 或抛出 FetchError('parse') */
    parse(json) {
      const infos = json && Array.isArray(json.balance_infos) ? json.balance_infos : null;
      if (!infos) throw new FetchError('parse', '返回格式无法识别（缺少 balance_infos）');
      const rows = infos
        .map((b) => ({ currency: b && b.currency, total: toNum(b && b.total_balance), granted: toNum(b && b.granted_balance), topped: toNum(b && b.topped_up_balance) }))
        .filter((r) => r.currency && r.total !== null);
      if (!rows.length) throw new FetchError('parse', '余额信息为空');
      const main = rows.find((r) => r.currency === 'CNY') || rows[0];
      const details = [];
      if (main.topped !== null) details.push({ label: '充值余额', value: `${main.topped} ${main.currency}` });
      if (main.granted !== null) details.push({ label: '赠送余额', value: `${main.granted} ${main.currency}` });
      for (const r of rows) if (r !== main) details.push({ label: `另有 ${r.currency} 余额`, value: `${r.total} ${r.currency}` });
      if (json.is_available === false) details.push({ label: '状态', value: '余额不足，API 暂不可用' });
      return { balance: main.total, unit: main.currency, details };
    },
  },

  'moonshot-cn': {
    label: 'Kimi / Moonshot（国内站 platform.kimi.com，CNY）',
    url: 'https://api.moonshot.cn/v1/users/me/balance',
    currencyHint: 'CNY',
    docs: 'https://platform.kimi.com/docs/api/balance',
    keyHint: 'Kimi 开放平台（国内站）API Key；国内站与国际站 Key 互不通用',
    parse(json) { return parseMoonshot(json, 'CNY'); },
  },

  'moonshot-ai': {
    label: 'Kimi / Moonshot（国际站 platform.kimi.ai，USD）',
    url: 'https://api.moonshot.ai/v1/users/me/balance',
    currencyHint: 'USD',
    docs: 'https://platform.kimi.ai/docs/api/balance',
    keyHint: 'Kimi 开放平台（国际站）API Key；国内站与国际站 Key 互不通用',
    parse(json) { return parseMoonshot(json, 'USD'); },
  },

  siliconflow: {
    label: '硅基流动 SiliconFlow（api.siliconflow.cn）',
    url: 'https://api.siliconflow.cn/v1/user/info',
    currencyHint: '站点币种（国内站为人民币）',
    docs: 'https://docs.siliconflow.com/cn/api-reference/userinfo/get-user-info',
    keyHint: '硅基流动 API Key',
    parse(json) {
      const d = json && json.data;
      if (!d || typeof d !== 'object') throw new FetchError('parse', '返回格式无法识别（缺少 data）');
      if (json.code !== undefined && json.code !== 20000) throw new FetchError('api', `接口返回异常 code=${json.code}`);
      const total = toNum(d.totalBalance);
      if (total === null) throw new FetchError('parse', '返回中没有 totalBalance');
      const details = [];
      const charge = toNum(d.chargeBalance);
      const gift = toNum(d.balance);
      if (charge !== null) details.push({ label: '充值余额', value: String(charge) });
      if (gift !== null) details.push({ label: '赠送余额', value: String(gift) });
      if (d.status && d.status !== 'normal') details.push({ label: '账户状态', value: String(d.status) });
      return { balance: total, unit: 'CNY', details };
    },
  },

  openrouter: {
    label: 'OpenRouter（需 Management Key）',
    url: 'https://openrouter.ai/api/v1/credits',
    currencyHint: 'USD（1 credit = 1 美元）',
    docs: 'https://openrouter.ai/docs/api/api-reference/credits/get-remaining-credits',
    keyHint: '必须是 OpenRouter 的 Management Key（普通 API Key 会返回 403）',
    parse(json) {
      const d = json && json.data;
      const credits = toNum(d && d.total_credits);
      const usage = toNum(d && d.total_usage);
      if (credits === null || usage === null) throw new FetchError('parse', '返回中缺少 total_credits / total_usage');
      return {
        balance: round(credits - usage),
        unit: 'USD',
        details: [
          { label: '累计充值', value: `${round(credits)} USD` },
          { label: '累计用量', value: `${round(usage)} USD` },
        ],
      };
    },
  },
};

function parseMoonshot(json, unit) {
  if (!json || typeof json !== 'object' || !json.data) throw new FetchError('parse', '返回格式无法识别（缺少 data）');
  if (json.code !== undefined && json.code !== 0) throw new FetchError('api', `接口返回异常 code=${json.code}`);
  const avail = toNum(json.data.available_balance);
  if (avail === null) throw new FetchError('parse', '返回中没有 available_balance');
  const details = [];
  const cash = toNum(json.data.cash_balance);
  const voucher = toNum(json.data.voucher_balance);
  if (cash !== null) details.push({ label: '现金余额', value: `${round(cash)} ${unit}` });
  if (voucher !== null) details.push({ label: '代金券余额', value: `${round(voucher)} ${unit}` });
  return { balance: round(avail), unit, details };
}

/** 对外暴露给渲染进程的 provider 列表（不含解析函数） */
function listProviders() {
  return Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, keyHint: p.keyHint, currencyHint: p.currencyHint, docs: p.docs }));
}

/** 把 HTTP 状态映射为中文错误（绝不回显密钥或响应体） */
function httpError(providerId, status) {
  if (status === 401) return new FetchError('auth', 'Key 无效或已失效（401）');
  if (status === 403) {
    return new FetchError('forbidden', providerId === 'openrouter'
      ? '无权限（403）：OpenRouter 余额接口需要 Management Key'
      : '无权限（403）：该 Key 没有查询余额的权限');
  }
  if (status === 404) return new FetchError('http', '接口不存在（404），可能官方已调整');
  if (status === 429) return new FetchError('rate', '请求过于频繁（429），稍后再试');
  if (status >= 500) return new FetchError('http', `服务端错误（${status}）`);
  return new FetchError('http', `请求失败（HTTP ${status}）`);
}

/**
 * 查询余额。
 * @param {string} providerId
 * @param {string} apiKey
 * @param {{fetchImpl?: Function, timeoutMs?: number}} [opts]
 * @returns {Promise<{balance:number, unit:string, details:Array}>}
 * @throws {FetchError}
 */
async function fetchBalance(providerId, apiKey, opts = {}) {
  const p = PROVIDERS[providerId];
  if (!p) throw new FetchError('provider', '未知的数据来源');
  if (!apiKey) throw new FetchError('nokey', '尚未配置 API Key');
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const timeoutMs = opts.timeoutMs || 15000;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(p.url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: ctl.signal,
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw new FetchError('timeout', '请求超时，请检查网络');
    throw new FetchError('network', '网络错误，无法连接到服务（请检查网络/代理）');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw httpError(providerId, res.status);
  let json;
  try {
    json = await res.json();
  } catch {
    throw new FetchError('parse', '返回内容不是有效的 JSON');
  }
  return p.parse(json);
}

module.exports = { PROVIDERS, FetchError, fetchBalance, listProviders, toNum };
