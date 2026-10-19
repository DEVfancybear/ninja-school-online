import { z } from 'zod';
import { QUEST_OBJECTIVE_KINDS } from '../constants/quest.js';

/** `npc-…`, `mob-…`, `item-…`, `quest-…`: tiền tố cố định rồi chữ thường, chữ số, gạch ngang. */
const NPC_ID = /^npc-[a-z0-9-]+$/;
const QUEST_ID = /^quest-[a-z0-9-]+$/;
const ITEM_ID = /^item-[a-z0-9-]+$/;
const FEATURE_ID = /^[a-z][a-z0-9-]*$/;

/**
 * Một mục tiêu nhiệm vụ. `targetId` là đối tượng tuỳ theo `kind`: NPC (`talk`), quái (`kill`),
 * bản đồ (`reach`), vật phẩm (`collect`); `checkGameData` kiểm từng id phải có thật.
 */
export const QuestObjectiveSchema = z.object({
  kind: z.enum(QUEST_OBJECTIVE_KINDS),
  targetId: z.string().min(1),
  count: z.number().int().min(1).default(1),
  /** Câu hiện trong nhật ký nhiệm vụ, ví dụ "Đánh hạ 2 Bù Nhìn". */
  description: z.string().min(1).max(120),
});

/** Một món thưởng khi trả nhiệm vụ. */
export const QuestRewardItemSchema = z.object({
  itemId: z.string().regex(ITEM_ID, 'id vật phẩm phải có dạng item-ten-mon'),
  quantity: z.number().int().min(1).default(1),
});

/** Phần thưởng khi trả nhiệm vụ: kinh nghiệm, yên và vật phẩm. */
export const QuestRewardsSchema = z.object({
  exp: z.number().int().min(0).default(0),
  yen: z.number().int().min(0).default(0),
  items: z.array(QuestRewardItemSchema).default([]),
});

/** Một nhiệm vụ trong `game-data/quests/*.json`. */
export const QuestSchema = z.object({
  id: z.string().regex(QUEST_ID, 'id nhiệm vụ phải có dạng quest-ten-nhiem-vu'),
  name: z.string().min(1).max(60),
  /** Chương của chính tuyến; M5 chỉ có chương 1. */
  chapter: z.number().int().min(1).default(1),
  summary: z.string().min(1).max(200),
  /** NPC giao nhiệm vụ: người chơi phải đang nói chuyện với NPC này mới nhận được. */
  giverNpcId: z.string().regex(NPC_ID, 'id NPC phải có dạng npc-ten-npc'),
  /** NPC nhận trả nhiệm vụ; thường trùng người giao, nhưng nhiệm vụ "bái sư" trả ở Sư Phụ. */
  turnInNpcId: z.string().regex(NPC_ID, 'id NPC phải có dạng npc-ten-npc'),
  levelRequired: z.number().int().min(1).default(1),
  /** Các nhiệm vụ phải trả xong trước; `checkGameData` kiểm id có thật và không có vòng. */
  requiresQuests: z
    .array(z.string().regex(QUEST_ID, 'id nhiệm vụ phải có dạng quest-…'))
    .default([]),
  objectives: z.array(QuestObjectiveSchema).min(1),
  rewards: QuestRewardsSchema,
  /** Cờ tính năng mở khóa khi trả nhiệm vụ (xem `QUEST_FEATURE_LABELS`). */
  unlocks: z
    .array(z.string().regex(FEATURE_ID, 'cờ tính năng chỉ gồm chữ thường và gạch ngang'))
    .default([]),
});

export type QuestObjective = z.infer<typeof QuestObjectiveSchema>;
export type QuestRewards = z.infer<typeof QuestRewardsSchema>;
export type Quest = z.infer<typeof QuestSchema>;
