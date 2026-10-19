import type { NpcDialog, NpcDialogNode, QuestView } from '@ninja/shared';
import type { ShopService } from '../shop/service.js';
import type { RoomNpc } from '../../world/room.js';

/** Nhánh hội thoại và danh sách nhiệm vụ WorldService đã chọn cho lần nói chuyện này. */
export interface NpcDialogExtras {
  /** Nhánh khớp với trạng thái nhiệm vụ/cấp của người chơi; không có thì dùng `lines` mặc định. */
  readonly node?: NpcDialogNode;
  /** Nhiệm vụ làm được ngay tại NPC này (nhận ở người giao, trả ở người nhận trả). */
  readonly quests?: readonly QuestView[];
}

/**
 * Hội thoại NPC. Từ M5 có cây hội thoại: nhánh chọn theo trạng thái nhiệm vụ và cấp (luật chọn nằm
 * ở `pickDialogNode`), còn danh sách nhiệm vụ của NPC do `QuestService.offersFor` cung cấp. NPC bán
 * hàng vẫn gửi kèm quầy hàng để client mở bảng mua ngay trong lúc nói chuyện.
 */
export class NpcService {
  constructor(private readonly shops: ShopService) {}

  /** Gói `S2C_NPC_DIALOG` cho một NPC đang có trong map. */
  dialog(npc: RoomNpc, extras: NpcDialogExtras = {}): NpcDialog {
    const lines = extras.node?.lines ?? npc.data.lines;
    return {
      npcId: npc.id,
      npcName: npc.name,
      lines: lines.map((line) => ({ speaker: line.speaker, text: line.text })),
      nodeId: extras.node?.id ?? null,
      // `next` luôn có mặt, `null` nghĩa là lựa chọn kết thúc hội thoại (client tự đóng bảng).
      options: (extras.node?.options ?? []).map((option) => ({
        id: option.id,
        text: option.text,
        next: option.next ?? null,
      })),
      quests: [...(extras.quests ?? [])],
      // NPC thường (không bán gì) trả `null` để client khỏi mở bảng hàng rỗng.
      shop: npc.data.shop.length > 0 ? this.shops.shopFor(npc.data) : null,
    };
  }
}
