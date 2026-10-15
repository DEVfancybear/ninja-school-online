/** Ba ngôi trường trong game. */
export const SCHOOLS = ['haruna', 'hirosaki', 'ookaza'] as const;
export type School = (typeof SCHOOLS)[number];

/** Sáu phái (lớp nhân vật), mỗi trường đào tạo hai phái. */
export const CLASSES = ['dao', 'quat', 'kiem', 'phieu_tieu', 'kunai', 'cung'] as const;
export type CharacterClass = (typeof CLASSES)[number];

/** Phái thuộc về trường nào. */
export const SCHOOL_CLASSES: Record<School, readonly CharacterClass[]> = {
  haruna: ['dao', 'quat'],
  hirosaki: ['kiem', 'phieu_tieu'],
  ookaza: ['kunai', 'cung'],
};
