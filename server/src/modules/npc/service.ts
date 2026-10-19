import type { NpcDialog } from '@ninja/shared';
import type { ShopService } from '../shop/service.js';
import type { RoomNpc } from '../../world/room.js';

/**
 * Hội thoại NPC. Ở M2 chỉ có một bước: NPC nào đang ở trong map hiện tại thì trả lời bằng toàn bộ
 * lời thoại trong `game-data/npcs/`; cây hội thoại theo nhiệm vụ để M5 làm. Từ M4, NPC bán hàng gửi
 * kèm luôn quầy hàng để client mở bảng mua ngay trong lúc nói chuyện.
 */
export class NpcService {
  constructor(private readonly shops: ShopService) {}

  /** Gói `S2C_NPC_DIALOG` cho một NPC đang có trong map. */
  dialog(npc: RoomNpc): NpcDialog {
    return {
      npcId: npc.id,
      npcName: npc.name,
      lines: npc.data.lines.map((line) => ({ speaker: line.speaker, text: line.text })),
      // Hội thoại theo cây và nhiệm vụ làm ở M5 (`WorldService` truyền nhánh đã chọn vào đây).
      nodeId: null,
      options: [],
      quests: [],
      // NPC thường (không bán gì) trả `null` để client khỏi mở bảng hàng rỗng.
      shop: npc.data.shop.length > 0 ? this.shops.shopFor(npc.data) : null,
    };
  }
}
