'use strict';
/**
 * 共享筛选逻辑：飞书式多条件组合（岗位雷达 / 待投递通用）
 * 字段白名单防注入；多值用 LIKE 集合，单选精确字段用 = 匹配
 */
const FILTER_FIELDS = {
  company_type: 'company_type', industry: 'industry', job_category: 'job_category',
  job_track: 'job_track', location: 'location', education_required: 'education_required',
  batch: 'batch', company: 'company', position: 'position', major_requirement: 'major_requirement',
  english_req: 'english_req', cert_req: 'cert_req', skill_req: 'skill_req',
};
const EQ_OPS = new Set(['eq', 'neq']); // 单值精确匹配
const LIKE_OPS = new Set(['contains', 'not_contains', 'in', 'all']); // 模糊/多值匹配

/** 解析 filters 条件数组（JSON）→ { where, params }；非法条件静默跳过 */
function buildFilters(raw, logic) {
  let arr = [];
  try { arr = JSON.parse(raw); } catch { /* ignore */ }
  if (!Array.isArray(arr) || !arr.length) return { where: '', params: [] };
  const conds = [];
  const params = [];
  for (const c of arr) {
    if (!c || typeof c !== 'object' || !FILTER_FIELDS[c.f]) continue;
    const col = FILTER_FIELDS[c.f];
    const op = String(c.op || '');
    if (op === 'empty') { conds.push(`(${col} IS NULL OR ${col} = '')`); continue; }
    if (op === 'not_empty') { conds.push(`(${col} IS NOT NULL AND ${col} != '')`); continue; }
    const vals = Array.isArray(c.v)
      ? c.v.filter((v) => v != null && String(v).trim() !== '')
      : String(c.v ?? '').split(/[,，、\n]/).map((s) => s.trim()).filter(Boolean);
    if (!vals.length) continue;
    if (EQ_OPS.has(op)) {
      conds.push(op === 'eq' ? `${col} = ?` : `(${col} IS NULL OR ${col} != ?)`);
      params.push(vals[0]);
    } else if (LIKE_OPS.has(op)) {
      const glue = op === 'all' ? ' AND ' : ' OR ';
      const neg = op === 'not_contains' ? 'NOT ' : '';
      conds.push(`(${neg}(${vals.map(() => `${col} LIKE ?`).join(glue)}))`);
      vals.forEach((v) => params.push(`%${v}%`));
    }
  }
  const join = logic === 'or' ? ' OR ' : ' AND ';
  return { where: conds.length ? `(${conds.join(join)})` : '', params };
}

module.exports = { FILTER_FIELDS, EQ_OPS, LIKE_OPS, buildFilters };
