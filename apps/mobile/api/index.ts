// Every call the screens make to Supabase goes through this module; nothing
// outside `api/` imports the Supabase client (a lint rule enforces it). Screen
// tests replace this index with Jest's automatic mock, so importing it must
// have no side effects. `./slots` is pure state with no network and is not
// re-exported: screens import it directly, so screen tests keep it real. The
// network reads of clients and visits are not re-exported either: screens read
// them through the cache in `./reads`.
export * from './auth';
export { type NewClient, createClient } from './clients';
export { type Connectivity, subscribeToConnectivity } from './connectivity';
export * from './dashboard';
export * from './photos';
export * from './previews';
export * from './reads';
export * from './styles';
export * from './uploads';
export {
  type Look,
  type NewVisit,
  type VisitDetail,
  type VisitSummary,
  chooseLook,
  closeVisit,
  createVisit,
  getVisit,
  getVisitDetail,
  listOpenVisitsToday,
} from './visits';
