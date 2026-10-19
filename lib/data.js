/**
 * 数据模型 / 默认值 / 迁移 / 合并（纯逻辑，无 Electron 依赖，可单测）
 */
const crypto = require('crypto');

const DATA_VERSION = 2;
const uid = () => crypto.randomBytes(8).toString('hex');

/** 一个平台的「空白」记录：所有未知值都是 null，绝不预填任何数字 */
function blankPlatform(o = {}) {
  return {
    id: uid(),
    name: '', vendor: '', plan: '', color: '#ff8fab',
    unit: '', balanceNote: '',
    balance: null,        // 用户手动填写的余额；未填 = null（界面显示「未获取」）
    quota: null,          // 5 小时限额 { total, used, resetAt }；未填 = null
    subscribeDate: null,
    expiryDate: null,
    autoRenew: null,      // true / false / null(未设置)
    notes: '',
    provider: '',         // 官方余额接口来源；'' = 仅手动
    fetch: null,          // 由主进程维护的获取结果（渲染进程不可改）
    ...o,
  };
}

/** 默认平台列表：只有名称/厂商/套餐/品牌色/单位等模板信息，没有任何余额/额度/日期 */
function presetPlatforms() {
  const P = blankPlatform;
  return [
    P({ name: 'ChatGPT', vendor: 'OpenAI', plan: 'Plus', color: '#10a37f', unit: 'USD', balanceNote: '订阅制 · 无公开余额接口' }),
    P({ name: 'Cursor', vendor: 'Anysphere', plan: 'Pro', color: '#4b4b52', unit: 'USD', balanceNote: '订阅制 · 无公开余额接口' }),
    P({ name: 'Grok', vendor: 'xAI', plan: 'SuperGrok', color: '#0f1419', unit: 'USD', balanceNote: '订阅制 · 无公开余额接口' }),
    P({ name: 'Gemini', vendor: 'Google', plan: 'AI Pro', color: '#4285f4', unit: 'CNY', balanceNote: '订阅制 · 无公开余额接口' }),
    P({ name: 'Claude Code', vendor: 'Anthropic', plan: 'Pro', color: '#d97757', unit: 'USD', balanceNote: '订阅制 · 无公开余额接口' }),
    P({ name: 'GLM Coding Plan', vendor: '智谱 AI', plan: 'Pro', color: '#3b5bff', unit: 'CNY', balanceNote: '订阅制 · 无公开余额接口' }),
    P({ name: 'DeepSeek', vendor: '深度求索', plan: 'API 按量计费', color: '#4d6bfe', unit: 'CNY', balanceNote: '填入 API Key 后可自动获取', provider: 'deepseek' }),
    P({ name: 'LongCat', vendor: '美团', plan: 'Coding 套餐', color: '#ffc400', unit: 'CNY', balanceNote: '订阅制 · 无公开余额接口' }),
    P({ name: 'Trae', vendor: '字节跳动', plan: 'Pro', color: '#00c2ff', unit: 'USD', balanceNote: '订阅制 · 无公开余额接口' }),
    P({ name: 'Qoder', vendor: '阿里巴巴', plan: 'Pro', color: '#ff6a00', unit: 'CNY', balanceNote: '订阅制 · 无公开余额接口' }),
    P({ name: 'OpenCode', vendor: 'OpenCode', plan: 'Zen', color: '#8b5cf6', unit: 'credits', balanceNote: '手动填写' }),
    P({ name: 'Cline', vendor: 'Cline', plan: 'Credits', color: '#ff5c39', unit: 'credits', balanceNote: '手动填写' }),
    P({ name: 'GitHub Copilot', vendor: 'GitHub', plan: 'Pro', color: '#24292e', unit: 'USD', balanceNote: '订阅制 · 无公开余额接口' }),
  ];
}

function defaultData() {
  return {
    version: DATA_VERSION,
    platforms: presetPlatforms(),
    settings: { petPosition: null, autoRefreshMinutes: 0, petModelPath: null },
  };
}

/**
 * 解析并迁移磁盘上的数据。
 * @returns {{data:object, action:'ok'|'migrated-v1'|'corrupt'|'missing'}}
 *  - missing   文件不存在 → 默认数据
 *  - corrupt   JSON 损坏 → 默认数据（调用方应备份原文件）
 *  - migrated-v1  没有 version 字段的旧数据（含假数据）→ 默认数据（调用方应备份到 ai-balances.backup-v1.json）
 */
function migrate(rawText) {
  if (rawText === null || rawText === undefined) return { data: defaultData(), action: 'missing' };
  let obj;
  try {
    obj = JSON.parse(rawText);
  } catch {
    return { data: defaultData(), action: 'corrupt' };
  }
  if (!obj || !Array.isArray(obj.platforms)) return { data: defaultData(), action: 'corrupt' };
  if (typeof obj.version !== 'number') {
    const fresh = defaultData();
    // 只保留桌宠位置这类与数据真伪无关的设置
    if (obj.settings && obj.settings.petPosition) fresh.settings.petPosition = obj.settings.petPosition;
    return { data: fresh, action: 'migrated-v1' };
  }
  obj.settings = { petPosition: null, autoRefreshMinutes: 0, petModelPath: null, ...(obj.settings || {}) };
  obj.platforms = obj.platforms.map((p) => ({ ...blankPlatform(), ...p }));
  return { data: obj, action: 'ok' };
}

const EDITABLE_FIELDS = ['name', 'vendor', 'plan', 'color', 'unit', 'balanceNote', 'balance', 'quota', 'subscribeDate', 'expiryDate', 'autoRenew', 'notes', 'provider'];

/**
 * 合并渲染进程提交的数据：
 *  - 只接受可编辑字段；fetch（获取结果）与密钥一律以主进程为准，渲染进程无法覆盖
 *  - provider 变化时清空旧的获取结果
 */
function mergeFromRenderer(current, incoming, validProviders) {
  const byId = new Map(current.platforms.map((p) => [p.id, p]));
  const platforms = incoming.platforms.map((ip) => {
    const old = byId.get(ip.id);
    const base = old ? { ...old } : blankPlatform({ id: ip.id || uid() });
    for (const f of EDITABLE_FIELDS) if (f in ip) base[f] = ip[f];
    if (base.provider && !validProviders.includes(base.provider)) base.provider = '';
    if (!old || old.provider !== base.provider) base.fetch = null;
    return base;
  });
  const settings = { ...current.settings };
  if (incoming.settings) {
    if (typeof incoming.settings.autoRefreshMinutes === 'number') settings.autoRefreshMinutes = incoming.settings.autoRefreshMinutes;
  }
  return { version: DATA_VERSION, platforms, settings };
}

/** 发给渲染进程的副本：永不包含密钥，仅带 hasKey 布尔值 */
function sanitizeForRenderer(data, keyIds) {
  return {
    version: data.version,
    settings: { petPosition: data.settings.petPosition, autoRefreshMinutes: data.settings.autoRefreshMinutes, customModel: !!data.settings.petModelPath },
    platforms: data.platforms.map((p) => ({ ...p, hasKey: keyIds.has(p.id) })),
  };
}

module.exports = { DATA_VERSION, uid, blankPlatform, presetPlatforms, defaultData, migrate, mergeFromRenderer, sanitizeForRenderer, EDITABLE_FIELDS };
