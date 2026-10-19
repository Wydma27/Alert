export const ROLES = ['ADMIN', 'DYREKCJA', 'NAUCZYCIEL'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrator',
  DYREKCJA: 'Dyrekcja',
  NAUCZYCIEL: 'Nauczyciel',
};

/** Role uprawnione do wysyłki alertów – dla nich 2FA jest obowiązkowe. */
export const SENDER_ROLES: readonly Role[] = ['ADMIN', 'DYREKCJA'];

export function requiresTwoFactor(role: Role): boolean {
  return SENDER_ROLES.includes(role);
}

/** Kto może przeglądać dane uczniów i opiekunów. */
export const DATA_VIEW_ROLES: readonly Role[] = ['ADMIN', 'DYREKCJA'];
/** Kto może zmieniać dane uczniów, opiekunów, klas, punktów zbiórki i importować. */
export const DATA_EDIT_ROLES: readonly Role[] = ['ADMIN'];
