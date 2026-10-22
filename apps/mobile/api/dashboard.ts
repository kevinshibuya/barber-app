import { notImplemented } from './not-implemented';

export interface Dashboard {
  visitsThisWeek: number;
  visitsThisMonth: number;
  visitsPerBarber: { barberId: string; displayName: string; visits: number }[];
  topHairStyles: { styleId: string; name: string; visits: number }[];
  topBeardStyles: { styleId: string; name: string; visits: number }[];
  returningClientShare: number;
  totalClients: number;
}

export async function getDashboard(): Promise<Dashboard> {
  return notImplemented('getDashboard');
}
