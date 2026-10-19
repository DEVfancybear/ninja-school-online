import type { Npc, NpcDialogNode, QuestViewState } from '@ninja/shared';

/**
 * Sự thật cần để chọn nhánh hội thoại. Truyền vào dạng tham số (chứ không đọc database trong này)
 * để luật chọn nhánh là hàm thuần, kiểm được bằng bài test không cần server.
 */
export interface DialogFacts {
  /** Trạng thái hiện tại của từng nhiệm vụ; nhiệm vụ **chưa mở** thì không có mặt trong map. */
  readonly questStates: ReadonlyMap<string, QuestViewState>;
  readonly level: number;
}

/**
 * Chọn nhánh hội thoại để nói với người chơi: **nhánh đầu tiên có `when` và khớp**, theo đúng thứ tự
 * khai báo trong file (thứ tự khai báo là thứ tự ưu tiên). Không nhánh nào khớp thì trả `undefined`
 * — người gọi dùng `lines` mặc định của NPC.
 *
 * Nhánh **không có `when`** không bao giờ được chọn ở đây: nó chỉ tới được bằng một lựa chọn `next`
 * ở nhánh trước (đoạn nói tiếp trong cùng cuộc hội thoại), nên tự chọn nó sẽ nuốt mất hội thoại
 * chính của NPC.
 */
export function pickDialogNode(npc: Npc, facts: DialogFacts): NpcDialogNode | undefined {
  for (const node of npc.dialog) {
    if (node.when !== undefined && matches(node.when, facts)) {
      return node;
    }
  }
  return undefined;
}

type DialogCondition = NonNullable<NpcDialogNode['when']>;

/** Mọi điều kiện ghi ra đều phải đúng; điều kiện không ghi thì bỏ qua. */
function matches(when: DialogCondition, facts: DialogFacts): boolean {
  if (when.questId !== undefined) {
    const state = facts.questStates.get(when.questId);
    // Nhiệm vụ chưa mở (thiếu cấp hoặc thiếu nhiệm vụ trước) không có trạng thái → nhánh không khớp:
    // người chơi chưa được biết tới nhiệm vụ đó thì NPC cũng không nhắc tới nó.
    if (state === undefined) {
      return false;
    }
    if (when.state !== undefined && state !== when.state) {
      return false;
    }
  } else if (when.state !== undefined) {
    // Điều kiện chỉ có `state` mà không nói nhiệm vụ nào thì không kiểm được — coi như không khớp
    // thay vì khớp bừa (dữ liệu như vậy là lỗi, `checkGameData` không sinh ra nó).
    return false;
  }
  if (when.levelAtLeast !== undefined && facts.level < when.levelAtLeast) {
    return false;
  }
  return true;
}
