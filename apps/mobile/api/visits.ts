import type { Visit } from '@barber/shared';
import { notImplemented } from './not-implemented';

export interface NewVisit {
  // Generated on the device, so a visit started on bad wifi is one row once online.
  id: string;
  clientId: string;
  consentGiven: true;
}

export interface Look {
  hairStyleId: string;
  beardStyleId: string;
  previewId: string;
}

export async function listRecentVisits(): Promise<Visit[]> {
  return notImplemented('listRecentVisits');
}

export async function listOpenVisitsToday(): Promise<Visit[]> {
  return notImplemented('listOpenVisitsToday');
}

export async function listClientVisits(clientId: string): Promise<Visit[]> {
  return notImplemented('listClientVisits');
}

export async function startVisit(input: NewVisit): Promise<Visit> {
  return notImplemented('startVisit');
}

export async function chooseLook(visitId: string, look: Look): Promise<Visit> {
  return notImplemented('chooseLook');
}

export async function closeVisit(visitId: string): Promise<Visit> {
  return notImplemented('closeVisit');
}
