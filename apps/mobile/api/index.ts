// Every call the screens make to Supabase goes through this module; nothing
// outside `api/` imports the Supabase client (a lint rule enforces it). Screen
// tests replace this index with Jest's automatic mock, so importing it must
// have no side effects.
export * from './auth';
export * from './clients';
export * from './dashboard';
export * from './photos';
export * from './previews';
export * from './share';
export * from './visits';
