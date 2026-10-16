import type { StatBlock } from './stats.js';

/**
 * Trang bị, shop và cường hóa (M4). Mọi con số của hệ thống nằm ở đây để client và server dùng chung:
 * client hiện giá, tỉ lệ thành công và chỉ số cộng thêm; server quyết định kết quả bằng đúng bộ số này.
 */

/** Bốn ô trang bị, khớp trường `slot` của vật phẩm trong `game-data/items/`. */
export const EQUIP_SLOTS = ['weapon', 'body', 'head', 'accessory'] as const;
export type EquipSlot = (typeof EQUIP_SLOTS)[number];

/** Tên ô trang bị để giao diện hiện thẳng, không tự đặt lại tên ở client. */
export const EQUIP_SLOT_LABELS: Record<EquipSlot, string> = {
  weapon: 'Vũ khí',
  body: 'Áo',
  head: 'Mũ',
  accessory: 'Phụ kiện',
};

/** Shop mua lại của người chơi ngần này tỉ lệ giá ghi trong `game-data/items/`. */
export const SELL_PRICE_RATIO = 0.4;

/** Giá shop mua lại một món: `floor(giá gốc × SELL_PRICE_RATIO)`, thấp nhất 1 yên. */
export function sellPrice(price: number): number {
  return Math.max(1, Math.floor(Math.max(0, price) * SELL_PRICE_RATIO));
}

/** Trần cấp cường hóa của mọi món; mỗi món còn có `upgradeMaxLevel` riêng, dùng số nhỏ hơn. */
export const UPGRADE_MAX_LEVEL = 5;

/**
 * Tỉ lệ thành công của lần cường hóa **từ cấp hiện tại lên cấp kế tiếp** (chỉ số = cấp hiện tại).
 * Cấp 0 → 1 chắc chắn thành công để người chơi mới luôn thấy hệ thống chạy được.
 */
export const UPGRADE_SUCCESS_RATES: readonly number[] = [1, 0.9, 0.75, 0.55, 0.35];

/** Số yên mỗi lần thử cường hóa, theo cấp hiện tại của món. */
export const UPGRADE_YEN_COST: readonly number[] = [50, 120, 260, 520, 1000];

/** Mỗi lần thử còn tốn ngần này món `UPGRADE_MATERIAL_ID` — đá rơi ra từ quái. */
export const UPGRADE_MATERIAL_ID = 'item-da-vun';
export const UPGRADE_MATERIAL_QTY = 1;

/** Mỗi cấp cường hóa cộng thêm ngần này tỉ lệ chỉ số gốc của món (làm tròn lên). */
export const UPGRADE_STAT_RATIO = 0.2;

/** Cấp cường hóa cao nhất của một món: số nhỏ hơn giữa trần chung và `upgradeMaxLevel` của món. */
export function upgradeMaxLevelOf(itemMaxLevel: number): number {
  return Math.max(0, Math.min(UPGRADE_MAX_LEVEL, Math.trunc(itemMaxLevel)));
}

/** Tỉ lệ thành công của lần cường hóa từ `currentLevel`; `0` nghĩa là đã chạm trần. */
export function upgradeSuccessRate(currentLevel: number): number {
  return UPGRADE_SUCCESS_RATES[currentLevel] ?? 0;
}

/** Số yên của lần cường hóa từ `currentLevel`; `0` nghĩa là đã chạm trần. */
export function upgradeYenCost(currentLevel: number): number {
  return UPGRADE_YEN_COST[currentLevel] ?? 0;
}

/** Một chỉ số ở cấp cường hóa `level`: giữ chỉ số gốc rồi cộng thêm theo từng cấp. */
export function statAtUpgradeLevel(stat: number, level: number): number {
  const steps = Math.max(0, Math.trunc(level));
  return stat + Math.ceil(stat * UPGRADE_STAT_RATIO * steps);
}

/** Cả khối chỉ số của một món ở cấp cường hóa `level`. */
export function statsAtUpgradeLevel(stats: StatBlock, level: number): StatBlock {
  return {
    strength: statAtUpgradeLevel(stats.strength, level),
    agility: statAtUpgradeLevel(stats.agility, level),
    spirit: statAtUpgradeLevel(stats.spirit, level),
    hp: statAtUpgradeLevel(stats.hp, level),
    mp: statAtUpgradeLevel(stats.mp, level),
  };
}

/** Cộng dồn chỉ số của nhiều món đang mặc thành một khối duy nhất. */
export function sumStats(blocks: readonly StatBlock[]): StatBlock {
  const total = { strength: 0, agility: 0, spirit: 0, hp: 0, mp: 0 };
  for (const block of blocks) {
    total.strength += block.strength;
    total.agility += block.agility;
    total.spirit += block.spirit;
    total.hp += block.hp;
    total.mp += block.mp;
  }
  return total;
}
