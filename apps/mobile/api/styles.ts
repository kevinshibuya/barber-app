import { STORAGE_BUCKETS, type Style, type Tables } from '@barber/shared';
import { supabase } from './supabase';

// A catalog style with the public URL of its reference image; null for keep,
// which has none.
export interface CatalogStyle extends Style {
  referenceImageUrl: string | null;
}

function toCatalogStyle(row: Tables<'styles'>): CatalogStyle {
  const path = row.reference_image_path;
  return {
    id: row.id,
    dimension: row.dimension,
    slug: row.slug,
    name: row.name,
    referenceImagePath: path,
    prompt: row.prompt,
    sortOrder: row.sort_order,
    active: row.active,
    referenceImageUrl: path ? supabase().storage.from(STORAGE_BUCKETS.styles).getPublicUrl(path).data.publicUrl : null,
  };
}

// The active styles of both dimensions, in the catalog's sort order.
export async function listStyles(): Promise<CatalogStyle[]> {
  const { data, error } = await supabase()
    .from('styles')
    .select('*')
    .eq('active', true)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return data.map(toCatalogStyle);
}
