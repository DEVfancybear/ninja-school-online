/**
 * Chiến đấu theo lượt (M3). Mọi con số của hệ thống chiến đấu nằm ở đây để client và server dùng
 * chung một nguồn: client vẽ thanh máu và đồng hồ lượt, server quyết định sát thương và phần thưởng.
 */

/** Mỗi lượt kéo dài bao lâu. Hết giờ thì người đang tới lượt tự đánh thường. */
export const BATTLE_TURN_SECONDS = 30;
export const BATTLE_TURN_MS = BATTLE_TURN_SECONDS * 1000;

/**
 * Quái "suy nghĩ" ngần này lâu trước khi ra đòn. Không đánh ngay trong cùng nhịp tick đã mở lượt để
 * client kịp hiện lượt của nó, và nhật ký trận đấu đọc ra như một trận theo lượt thật.
 */
export const MONSTER_TURN_DELAY_MS = 800;

/** Số người chơi tối đa trong một trận (M3: hai người đánh chung một con quái). */
export const BATTLE_MAX_PLAYERS = 2;

/** Khoảng cách tối đa (pixel) để "chạm quái". Xa hơn thì server từ chối lệnh vào trận. */
export const MONSTER_ENGAGE_RANGE_PX = 96;

/** Sát thương luôn ít nhất là ngần này, kể cả khi phòng thủ cao hơn tấn công. */
export const MIN_DAMAGE = 1;

/** Dao động sát thương ±10% để hai đòn giống nhau không ra cùng một số. */
export const DAMAGE_VARIANCE = 0.1;

/** Tỉ lệ đòn chí mạng và hệ số nhân sát thương của nó. */
export const CRITICAL_CHANCE = 0.05;
export const CRITICAL_MULTIPLIER = 1.5;

/** Đòn đánh thường: `power + factor × chỉ số sức mạnh` (quái dùng chỉ số tấn công của nó). */
export const NORMAL_ATTACK_POWER = 2;
export const NORMAL_ATTACK_FACTOR = 1;

/** Mỗi điểm nhanh nhẹn cho ngần này điểm phòng thủ (làm tròn xuống). */
export const DEFENSE_PER_AGILITY = 0.5;

/** Thua trận: hồi sinh ở làng với ngần này tỉ lệ máu tối đa, và mất ngần này tỉ lệ số yên đang có. */
export const REVIVE_HP_RATIO = 0.5;
export const DEFEAT_YEN_LOSS_RATIO = 0.1;

/** Cấp tối đa và đường cong kinh nghiệm: `EXP_BASE × cấp^EXP_EXPONENT`. */
export const LEVEL_MAX = 60;
export const EXP_BASE = 50;
export const EXP_EXPONENT = 1.6;

/** Tỉ lệ chạy thoát: 50% cơ bản, mỗi điểm nhanh nhẹn chênh lệch cộng 2%, kẹp trong [10%, 90%]. */
export const FLEE_BASE_CHANCE = 0.5;
export const FLEE_AGILITY_FACTOR = 0.02;
export const FLEE_MIN_CHANCE = 0.1;
export const FLEE_MAX_CHANCE = 0.9;

/** Kinh nghiệm cần để lên cấp kế tiếp; `0` nghĩa là đã đạt cấp tối đa. */
export function expToNextLevel(level: number): number {
  if (level >= LEVEL_MAX) {
    return 0;
  }
  return Math.round(EXP_BASE * level ** EXP_EXPONENT);
}

export interface ExpGain {
  readonly level: number;
  readonly exp: number;
  /** Số cấp lên được sau lần cộng kinh nghiệm này. */
  readonly levelsGained: number;
}

/** Cộng kinh nghiệm và lên cấp liên tiếp cho tới khi hết kinh nghiệm hoặc chạm cấp tối đa. */
export function applyExpGain(level: number, exp: number, gained: number): ExpGain {
  let currentLevel = level;
  let currentExp = exp + Math.max(0, Math.trunc(gained));
  let levelsGained = 0;
  for (;;) {
    const needed = expToNextLevel(currentLevel);
    if (needed === 0 || currentExp < needed) {
      break;
    }
    currentExp -= needed;
    currentLevel += 1;
    levelsGained += 1;
  }
  return { level: currentLevel, exp: currentExp, levelsGained };
}

/**
 * Hồi chiêu của một chiêu tính theo **vòng** (mọi người tham gia hành động một lần là hết một vòng):
 * trận đấu theo lượt không có đồng hồ chung để đếm mili giây, nên quy đổi ngay từ dữ liệu chiêu.
 */
export function skillCooldownTurns(cooldownMs: number): number {
  if (cooldownMs <= 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(cooldownMs / BATTLE_TURN_MS));
}
