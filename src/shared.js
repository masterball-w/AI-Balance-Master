/**
 * 管理器与桌宠共用的显示逻辑：任何未知值一律显示「未获取」，绝不编造数字。
 */
(function (global) {
  const NA = '未获取';
  const isNum = (v) => v !== null && v !== undefined && v !== '' && !isNaN(Number(v));

  function fmtNum(n) {
    const v = Number(n);
    if (Number.isInteger(v)) return v.toLocaleString();
    return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const p = (n) => String(n).padStart(2, '0');
    const now = new Date();
    const same = d.toDateString() === now.toDateString();
    return `${same ? '' : `${d.getMonth() + 1}/${d.getDate()} `}${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /** 余额：接口获取 > 获取失败时的上次真实值（标记过期）> 手动填写 > 未获取 */
  function balanceInfo(p) {
    const f = p.fetch;
    if (f && f.status === 'ok' && isNum(f.balance)) return { kind: 'api', value: Number(f.balance), unit: f.unit || p.unit || '', time: f.lastFetched };
    if (f && f.status === 'error' && isNum(f.balance)) return { kind: 'stale', value: Number(f.balance), unit: f.unit || p.unit || '', time: f.lastFetched };
    if (isNum(p.balance)) return { kind: 'manual', value: Number(p.balance), unit: p.unit || '' };
    return { kind: 'none' };
  }
  function balanceText(p) {
    const b = balanceInfo(p);
    return b.kind === 'none' ? NA : `${fmtNum(b.value)}${b.unit ? ' ' + b.unit : ''}`;
  }

  /** 状态：未获取 / 已获取 / 获取失败 / 手动 */
  function fetchStatus(p) {
    const f = p.fetch;
    if (p.provider) {
      if (f && f.status === 'ok') return { key: 'ok', text: '已获取' };
      if (f && f.status === 'error') return { key: 'error', text: '获取失败' };
      return { key: 'none', text: NA };
    }
    return balanceInfo(p).kind === 'manual' || (p.quota && Number(p.quota.total) > 0) ? { key: 'manual', text: '手动填写' } : { key: 'none', text: NA };
  }

  function quotaKnown(p) { return !!(p.quota && Number(p.quota.total) > 0); }

  global.Shared = { NA, isNum, fmtNum, fmtTime, balanceInfo, balanceText, fetchStatus, quotaKnown };
})(window);
