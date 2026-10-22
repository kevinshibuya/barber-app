export const BARBER_ROLES = ['owner', 'barber'] as const;
export type BarberRole = (typeof BARBER_ROLES)[number];

export function isBarberRole(value: unknown): value is BarberRole {
  return BARBER_ROLES.some((role) => role === value);
}

export interface Barber {
  id: string;
  shopId: string;
  displayName: string;
  role: BarberRole;
}
