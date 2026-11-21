const countActive = "SELECT count(*) FROM visits WHERE ended_at IS NULL AND expires_at>?";
export const seatsSql = `COALESCE((SELECT max(0,capacity-(${countActive})) FROM kiosk_settings WHERE id=1),2147483647)`;
export async function occupancy(m, clock) {
  const state=await m.one(`SELECT (SELECT capacity FROM kiosk_settings WHERE id=1) AS capacity,(${countActive}) AS occupied`,clock);
  return { ...state, places:state.capacity === null ? null : Math.max(0,state.capacity-state.occupied) };
}
