export function audit(m, me, area, action, target, before, after, changed = false) {
  return m.stmt(`INSERT INTO audit_log (id,at,actor,area,action,target,before_json,after_json)
    SELECT ?,?,?,?,?,?,?,?${changed ? " WHERE changes()>0" : ""}`,
  crypto.randomUUID(),Date.now(),me.name,area,action,target,before === null ? null : JSON.stringify(before),after === null ? null : JSON.stringify(after));
}

export async function auditRows(m, area, before) {
  const rows=await m.list(`SELECT * FROM audit_log WHERE (?='' OR area=?) AND at<? ORDER BY at DESC,id DESC LIMIT 101`,area,area,before);
  // Return tied entries on a page together so time-based pagination never drops them.
  if (rows.length===101) {
    const edge=rows[99].at;
    const extra=await m.list("SELECT * FROM audit_log WHERE at=? AND (?='' OR area=?) ORDER BY id DESC",edge,area,area);
    return {rows:[...rows.slice(0,100).filter(row=>row.at!==edge),...extra],next:edge};
  }
  return {rows,next:null};
}
