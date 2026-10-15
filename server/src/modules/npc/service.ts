import type { NpcDialog } from '@ninja/shared';
import type { RoomNpc } from '../../world/room.js';

/**
 * Hội thoại NPC. Ở M2 chỉ có một bước: NPC nào đang ở trong map hiện tại thì trả lời bằng toàn bộ
 * lời thoại trong `game-data/npcs/`; cây hội thoại theo nhiệm vụ để M5 làm.
 */
export class NpcService {
  /** Gói `S2C_NPC_DIALOG` cho một NPC đang có trong map. */
  dialog(npc: RoomNpc): NpcDialog {
    return {
      npcId: npc.id,
      npcName: npc.name,
      lines: npc.data.lines.map((line) => ({ speaker: line.speaker, text: line.text })),
    };
  }
}
