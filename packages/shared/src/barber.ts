import { Constants } from './database';

export const BARBER_ROLES = Constants.public.Enums.barber_role;
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
