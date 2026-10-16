import { SCHOOLS, SCHOOL_CLASSES } from '../constants/game.js';
import type { Item } from './item.js';
import type { GameMap, Npc } from './map.js';
import type { Monster } from './monster.js';
import type { ClassDefinition } from './school.js';
import type { Skill } from './skill.js';

/** Một lỗi dữ liệu: file nào, trường nào, sai thế nào. */
export interface GameDataIssue {
  /** Đường dẫn tương đối trong game-data, ví dụ `maps/lang-khoi-nguon.json`. */
  readonly file: string;
  /** Đường dẫn trường bên trong file, ví dụ `ground.3`. */
  readonly path: string;
  readonly message: string;
}

/** Toàn bộ nội dung game-data đã qua kiểm tra schema từng file. */
export interface GameDataSet {
  readonly maps: readonly GameMap[];
  readonly npcs: readonly Npc[];
  readonly monsters: readonly Monster[];
  readonly skills: readonly Skill[];
  readonly items: readonly Item[];
  readonly classes: readonly ClassDefinition[];
}

/** Hai file cùng `id` sẽ ghi đè nhau âm thầm khi nạp theo id, nên phải là lỗi. */
function checkUniqueIds(data: GameDataSet): GameDataIssue[] {
  const issues: GameDataIssue[] = [];
  const collections: readonly (readonly [string, string, readonly { id: string }[]])[] = [
    ['maps', 'bản đồ', data.maps],
    ['npcs', 'NPC', data.npcs],
    ['monsters', 'quái', data.monsters],
    ['skills', 'chiêu', data.skills],
    ['items', 'vật phẩm', data.items],
  ];
  for (const [dir, kind, values] of collections) {
    const seen = new Set<string>();
    for (const value of values) {
      if (seen.has(value.id)) {
        issues.push({
          file: `${dir}/`,
          path: 'id',
          message: `${kind} "${value.id}" bị khai báo ở nhiều file`,
        });
      }
      seen.add(value.id);
    }
  }

  const schools = new Set<string>();
  for (const definition of data.classes) {
    if (schools.has(definition.school)) {
      issues.push({
        file: 'classes/',
        path: 'school',
        message: `trường "${definition.school}" có nhiều hơn một file chỉ số phái`,
      });
    }
    schools.add(definition.school);
  }

  return issues;
}

/** Mỗi cổng phải dẫn tới bản đồ có thật, và điểm spawn đích phải có ở bản đồ đó. */
function checkPortals(maps: ReadonlyMap<string, GameMap>): GameDataIssue[] {
  const issues: GameDataIssue[] = [];
  for (const map of maps.values()) {
    const file = `maps/${map.id}.json`;
    for (const portal of map.portals) {
      const target = maps.get(portal.toMap);
      if (!target) {
        issues.push({
          file,
          path: `portals.${portal.id}.toMap`,
          message: `cổng dẫn tới bản đồ "${portal.toMap}" không tồn tại`,
        });
        continue;
      }
      if (!target.spawns.some((spawn) => spawn.id === portal.toSpawn)) {
        issues.push({
          file,
          path: `portals.${portal.id}.toSpawn`,
          message: `bản đồ "${target.id}" không có điểm spawn "${portal.toSpawn}"`,
        });
      }
    }
  }
  return issues;
}

/** NPC và quái đặt trên bản đồ phải có file dữ liệu tương ứng. */
function checkPlacements(
  maps: ReadonlyMap<string, GameMap>,
  npcs: ReadonlySet<string>,
  monsters: ReadonlySet<string>,
): GameDataIssue[] {
  const issues: GameDataIssue[] = [];
  for (const map of maps.values()) {
    const file = `maps/${map.id}.json`;
    for (const placement of map.npcs) {
      if (!npcs.has(placement.id)) {
        issues.push({
          file,
          path: `npcs.${placement.id}`,
          message: `chưa có file hội thoại cho NPC "${placement.id}" trong game-data/npcs/`,
        });
      }
    }
    for (const placement of map.monsters) {
      if (!monsters.has(placement.id)) {
        issues.push({
          file,
          path: `monsters.${placement.id}`,
          message: `chưa có file dữ liệu cho quái "${placement.id}" trong game-data/monsters/`,
        });
      }
    }
  }
  return issues;
}

/** Mọi thứ dữ liệu nhắc tới (quà rơi, đồ khởi đầu) phải là vật phẩm có thật. */
function checkItemReferences(
  monsters: readonly Monster[],
  classes: readonly ClassDefinition[],
  items: ReadonlySet<string>,
): GameDataIssue[] {
  const issues: GameDataIssue[] = [];
  for (const monster of monsters) {
    for (const [index, drop] of monster.drops.entries()) {
      if (!items.has(drop.itemId)) {
        issues.push({
          file: `monsters/${monster.id}.json`,
          path: `drops.${index}.itemId`,
          message: `quái rơi vật phẩm "${drop.itemId}" nhưng không có file trong game-data/items/`,
        });
      }
    }
  }
  for (const definition of classes) {
    for (const [index, item] of definition.startingItems.entries()) {
      if (!items.has(item.itemId)) {
        issues.push({
          file: `classes/school-${definition.school}.json`,
          path: `startingItems.${index}.itemId`,
          message: `đồ khởi đầu "${item.itemId}" không có file trong game-data/items/`,
        });
      }
    }
  }
  return issues;
}

/**
 * Chiêu phải thuộc đúng trường của phái mình, và chỉ dùng những gì hệ thống chiến đấu M3 đã làm
 * được: một mục tiêu, không hiệu ứng phụ. Dữ liệu không được hứa thứ mã nguồn chưa làm.
 */
function checkSkills(skills: readonly Skill[]): GameDataIssue[] {
  const issues: GameDataIssue[] = [];
  for (const skill of skills) {
    const file = `skills/${skill.id}.json`;
    const allowed = SCHOOL_CLASSES[skill.school];
    if (!allowed.includes(skill.class)) {
      issues.push({
        file,
        path: 'class',
        message: `trường ${skill.school} chỉ đào tạo phái ${allowed.join(', ')}, không có phái ${skill.class}`,
      });
    }
    if (skill.targets !== 1) {
      issues.push({
        file,
        path: 'targets',
        message: 'M3 chỉ đánh được một mục tiêu, đặt targets là 1 (đánh nhiều mục tiêu để sau)',
      });
    }
    if (skill.effects.length > 0) {
      issues.push({
        file,
        path: 'effects',
        message: 'M3 chưa có hiệu ứng phụ (độc, choáng, hồi máu...), để effects rỗng',
      });
    }
  }
  return issues;
}

/**
 * Mỗi trường phải có file chỉ số, và mỗi phái phải có ít nhất một chiêu chủ động học được ở cấp 1 —
 * không thì nhân vật mới của phái đó vào trận chỉ biết đánh thường.
 */
function checkClassCoverage(data: GameDataSet): GameDataIssue[] {
  if (data.classes.length === 0) {
    return [];
  }

  const issues: GameDataIssue[] = [];
  const defined = new Set(data.classes.map((definition) => definition.school));
  for (const school of SCHOOLS) {
    if (!defined.has(school)) {
      issues.push({
        file: 'classes/',
        path: school,
        message: `trường "${school}" chưa có file chỉ số phái trong game-data/classes/`,
      });
    }
  }

  for (const [school, classes] of Object.entries(SCHOOL_CLASSES)) {
    for (const characterClass of classes) {
      const hasStartingSkill = data.skills.some(
        (skill) =>
          skill.school === school &&
          skill.class === characterClass &&
          skill.type === 'active' &&
          skill.levelRequired === 1,
      );
      if (!hasStartingSkill) {
        issues.push({
          file: `classes/school-${school}.json`,
          path: characterClass,
          message: `phái "${characterClass}" chưa có chiêu chủ động nào ở cấp 1 nên không đánh được`,
        });
      }
    }
  }

  return issues;
}

/**
 * Kiểm tra liên-file của game-data: id trùng, cổng và chỗ đặt NPC/quái, vật phẩm được nhắc tới,
 * chiêu thức và độ phủ nội dung của từng phái.
 *
 * Hàm thuần (không đọc file) nên cả `tools/data-validator` và server dùng chung đúng một bộ luật;
 * hai nơi chỉ khác nhau ở cách đọc file và cách báo lỗi.
 */
export function checkGameData(data: GameDataSet): GameDataIssue[] {
  const issues = checkUniqueIds(data);
  if (issues.length > 0) {
    // Một id trùng làm mọi kiểm tra theo id sau đó vô nghĩa, tránh báo lỗi dây chuyền khó hiểu.
    return issues;
  }

  const maps = new Map(data.maps.map((map) => [map.id, map]));
  const npcs = new Set(data.npcs.map((npc) => npc.id));
  const monsters = new Set(data.monsters.map((monster) => monster.id));
  const items = new Set(data.items.map((item) => item.id));

  return [
    ...checkPortals(maps),
    ...checkPlacements(maps, npcs, monsters),
    ...checkItemReferences(data.monsters, data.classes, items),
    ...checkSkills(data.skills),
    ...checkClassCoverage(data),
  ];
}
