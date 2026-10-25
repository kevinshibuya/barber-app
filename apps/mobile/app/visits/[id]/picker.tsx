import { AnglePager, AnglePills } from '@/components/angle-pager';
import { ConnectivityIndicator } from '@/components/connectivity-indicator';
import { FormError } from '@/components/form-error';
import { FullScreenPreview } from '@/components/full-screen-preview';
import { ChoosePill, LookStatus, type LockReason } from '@/components/look-status';
import { PickerTile } from '@/components/picker-tile';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Image } from '@/components/ui/image';
import { Text } from '@/components/ui/text';
import {
  chooseLook,
  getClient,
  getVisit,
  listStyles,
  listVisitPhotos,
  requestPreview,
  retryPreview,
  subscribeToPreviews,
  type VisitPreview,
} from '@/api';
import {
  type Catalog,
  type LookPreview,
  lookFor,
  type PairRequest,
  requestKey,
  type Selection,
  selectable,
  type Tile,
  tilesFor,
  toCatalog,
} from '@/lib/picker';
import { strings } from '@/lib/strings';
import { cn } from '@/lib/utils';
import { type PhotoSlot, STYLE_DIMENSIONS, type StyleDimension, type Visit } from '@barber/shared';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

// The header's scrim, darkest at the top edge, so its white text reads on any photo.
const HEADER_SCRIM = { backgroundImage: 'linear-gradient(to bottom, rgba(0, 0, 0, 0.55), transparent)' };
const GRID_PADDING = 16;
const GRID_GAP = 8;

interface PickerData {
  visit: Visit;
  clientName: string;
  catalog: Catalog;
  // The uploaded photos in angle order: the pager's pages. The front alone,
  // without a photo, when none is uploaded yet.
  angles: { slot: PhotoSlot; url: string | null }[];
}

async function loadPicker(visitId: string): Promise<PickerData> {
  const [visit, styles, photos] = await Promise.all([getVisit(visitId), listStyles(), listVisitPhotos(visitId)]);
  const catalog = toCatalog(styles);
  if (!catalog) throw new Error('the catalog has no keep style');
  const found = await getClient(visit.clientId);
  const angles = photos
    .filter((photo) => photo.uploadStatus === 'uploaded')
    .map((photo) => ({ slot: photo.slot, url: photo.url }));
  return {
    visit,
    clientName: found.name,
    catalog,
    angles: angles.length > 0 ? angles : [{ slot: 'front', url: null }],
  };
}

// The picker of a visit, after docs/design/picker-references.md: the selected
// look large on top (the spine's preview, with graft D's header and the
// floating choose pill), and below it the hair and beard tabs over a grid of
// tiles that fill in as the visit's previews render. The look is a pager over
// the visit's angles, with angle pills on the photo; the angle on screen is
// the one the grid and full screen show. Tapping the look opens it full
// screen. Combinations and other angles render on demand, requested the first
// time they are shown.
export default function PickerScreen() {
  const router = useRouter();
  const { id: visitId } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<PickerData | null>(null);
  const [failed, setFailed] = useState(false);
  const [previews, setPreviews] = useState<VisitPreview[]>([]);
  const [tab, setTab] = useState<StyleDimension>('hair');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [fullScreen, setFullScreen] = useState(false);
  // The angle on screen; the selection is the same on every angle.
  const [angle, setAngle] = useState<PhotoSlot>('front');
  // Requests sent this visit, and those that failed before a row existed.
  const requested = useRef(new Set<string>());
  const [unrequested, setUnrequested] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let current = true;
    loadPicker(visitId).then(
      (loaded) => {
        if (!current) return;
        setData(loaded);
        // The picker opens on the visit's chosen look, or on keep with keep.
        const { visit, catalog } = loaded;
        setSelection({
          hair: visit.chosenHairStyleId ?? catalog.keep.hair.id,
          beard: visit.chosenBeardStyleId ?? catalog.keep.beard.id,
        });
      },
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, [visitId, attempt]);

  // Back on a picker still mounted, as from finish, the visit is read again:
  // an after photo taken meanwhile locks its look.
  useFocusEffect(
    useCallback(() => {
      let current = true;
      getVisit(visitId).then(
        (visit) => current && setData((loaded) => loaded && { ...loaded, visit }),
        () => undefined,
      );
      return () => {
        current = false;
      };
    }, [visitId]),
  );

  // Each delivery of the feed warms the image cache with the done previews.
  const [prefetch] = useState(previewPrefetcher);
  useEffect(
    () =>
      subscribeToPreviews(visitId, (delivered) => {
        setPreviews(delivered);
        prefetch(delivered);
      }),
    [visitId, prefetch],
  );

  // The look on every angle, as the pages show it, and the one on screen.
  const looks =
    data && selection
      ? data.angles.map((page) => settle(lookFor(selection, data.catalog, previews, page.slot, page.url), unrequested))
      : [];
  const shown = looks.find((look) => look.slot === angle) ?? looks[0] ?? null;

  // Asks once for the look on screen while it is on demand without a row; a
  // retry asks again.
  useEffect(() => {
    if (shown?.request && !requested.current.has(requestKey(shown.request))) void request(shown.request);
  });

  async function request(pair: PairRequest) {
    const key = requestKey(pair);
    requested.current.add(key);
    setUnrequested((current) => without(current, key));
    try {
      const row = await requestPreview({ visitId, ...pair });
      if (!row) return;
      setPreviews((current) =>
        current.some((preview) => preview.id === row.id)
          ? current
          : [...current, { ...row, thumbnailUrl: null, imageUrl: null }],
      );
    } catch {
      setUnrequested((current) => new Set(current).add(key));
    }
  }

  function retryLook(look: LookPreview) {
    if (look.preview) void retry(look.preview);
    else if (look.request) void request(look.request);
  }

  function reload() {
    setFailed(false);
    setAttempt((count) => count + 1);
  }

  function back() {
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: '/visits/[id]/photos', params: { id: visitId } });
  }

  function finish() {
    router.push({ pathname: '/visits/[id]/finish', params: { id: visitId } });
  }

  async function retry(preview: VisitPreview) {
    try {
      const reset = await retryPreview(preview.id);
      setPreviews((current) =>
        current.map((row) => (row.id === reset.id ? { ...reset, thumbnailUrl: null, imageUrl: null } : row)),
      );
    } catch {
      // The tile stays failed and can be tapped again.
    }
  }

  function press(tile: Tile) {
    if (tile.status === 'failed' && tile.preview) void retry(tile.preview);
    else if (selectable(tile)) setSelection((current) => current && { ...current, [tab]: tile.style.id });
  }

  if (!data || !selection) {
    return failed ? (
      <Screen className="items-center justify-center">
        <Text>{strings.picker.loadFailed}</Text>
        <Button variant="outline" onPress={reload}>
          <Text>{strings.picker.retry}</Text>
        </Button>
      </Screen>
    ) : (
      <Screen className="items-center justify-center">
        <ActivityIndicator />
      </Screen>
    );
  }

  const { visit, catalog } = data;
  const look = shown!;
  const angles = data.angles.map((page) => page.slot);
  const current = look.slot;
  const photoUrl = data.angles.find((page) => page.slot === current)?.url ?? null;
  // A recorded look has its preview, unless it is keep with keep, which has none.
  const keepBoth = selection.hair === catalog.keep.hair.id && selection.beard === catalog.keep.beard.id;
  const chosen =
    visit.chosenHairStyleId === selection.hair &&
    visit.chosenBeardStyleId === selection.beard &&
    (keepBoth || visit.chosenPreviewId !== null);
  // Once the after photo is taken, or the visit closed, the look is the record.
  const locked: LockReason | null =
    visit.afterPhotoPath !== null ? 'afterPhoto' : visit.status === 'closed' ? 'closed' : null;
  const tileWidth = (width - GRID_PADDING * 2 - GRID_GAP * 2) / 3;

  async function choose(chosenLook: LookPreview) {
    setSaving(true);
    setSaveFailed(false);
    try {
      const saved = await chooseLook(visitId, {
        hairStyleId: selection!.hair,
        beardStyleId: selection!.beard,
        previewId: chosenLook.previewId,
      });
      setData((current) => current && { ...current, visit: saved });
      setFullScreen(false);
      finish();
    } catch {
      setFullScreen(false);
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  }

  const pill = (shownLook: LookPreview) => (
    <ChoosePill
      look={shownLook}
      chosen={chosen}
      locked={locked}
      saving={saving}
      onChoose={(picked) => void choose(picked)}
    />
  );

  return (
    <View className="bg-background flex-1">
      {fullScreen && (
        <FullScreenPreview
          looks={looks}
          angle={current}
          onAngle={setAngle}
          onClose={() => setFullScreen(false)}
          onRetry={retryLook}
          choose={pill}
        />
      )}
      <View className="bg-muted flex-[3] justify-between">
        <AnglePager
          angles={angles}
          angle={current}
          onAngle={setAngle}
          style={StyleSheet.absoluteFill}
          renderPage={(pageAngle, onScreen) => {
            const pageLook = looks.find((entry) => entry.slot === pageAngle);
            // Only the page on screen is the button and the look image.
            return (
              <Pressable
                role={onScreen ? 'button' : undefined}
                accessibilityLabel={onScreen ? strings.picker.a11y.openPreview : undefined}
                onPress={() => setFullScreen(true)}
                className="flex-1"
              >
                {/* No transition and no recycling key: a new look replaces the
                    last one only once it is decoded, so the photo never blanks.
                    The memory cache is the one the prefetch filled. */}
                {pageLook?.imageUrl && (
                  <Image
                    testID={onScreen ? 'look-image' : undefined}
                    source={{ uri: pageLook.imageUrl }}
                    cachePolicy="memory-disk"
                    contentFit="cover"
                    transition={0}
                    className="absolute inset-0"
                  />
                )}
              </Pressable>
            );
          }}
        />
        <SafeAreaView edges={['top']} style={HEADER_SCRIM} className="gap-2 px-2 pb-6" pointerEvents="box-none">
          <View className="flex-row items-center">
            <Pressable role="button" accessibilityLabel={strings.picker.a11y.back} onPress={back} className="p-2">
              <Icon as={ArrowLeft} size={24} className="text-white" />
            </Pressable>
            <View className="flex-1 items-center">
              <Text numberOfLines={1} className="text-center text-base font-semibold text-white">
                {data.clientName}
              </Text>
              <ConnectivityIndicator inverted />
            </View>
            <Button variant="link" size="sm" onPress={finish}>
              <Text className="text-white">{strings.picker.finish}</Text>
            </Button>
          </View>
          <AnglePills angles={angles} angle={current} onAngle={setAngle} className="justify-center" />
        </SafeAreaView>
        <View className="flex-row items-end justify-between gap-3 p-3" pointerEvents="box-none">
          <View className="flex-1 items-start">
            <LookStatus look={look} onRetry={retryLook} />
          </View>
          {pill(look)}
        </View>
      </View>
      <View className="flex-[2]">
        {saveFailed && (
          <View className="px-4 pt-2">
            <FormError message={strings.picker.chooseError} />
          </View>
        )}
        <View role="tablist" className="border-border flex-row gap-6 border-b px-4 pt-3">
          {STYLE_DIMENSIONS.map((dimension) => {
            const active = dimension === tab;
            return (
              <Pressable
                key={dimension}
                role="tab"
                accessibilityLabel={strings.picker.tab[dimension]}
                accessibilityState={{ selected: active }}
                onPress={() => setTab(dimension)}
                className="items-center gap-1.5"
              >
                <Text className={cn('text-base', active ? 'text-foreground font-bold' : 'text-muted-foreground')}>
                  {strings.picker.tab[dimension]}
                </Text>
                <View className={cn('h-0.5 w-6 rounded-full', active ? 'bg-foreground' : 'bg-transparent')} />
              </Pressable>
            );
          })}
        </View>
        {/* The tiles scroll under the navigation bar; the last row scrolls clear of it. */}
        <ScrollView
          testID="picker-grid"
          contentContainerStyle={{ padding: GRID_PADDING, paddingBottom: GRID_PADDING + insets.bottom, gap: GRID_GAP }}
          contentContainerClassName="flex-row flex-wrap"
        >
          {tilesFor(tab, catalog, previews, current, photoUrl).map((tile) => (
            <PickerTile
              key={tile.style.id}
              tile={tile}
              width={tileWidth}
              selected={selection[tab] === tile.style.id}
              onPress={() => press(tile)}
            />
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

function without(keys: ReadonlySet<string>, key: string): ReadonlySet<string> {
  if (!keys.has(key)) return keys;
  const rest = new Set(keys);
  rest.delete(key);
  return rest;
}

// Fetches the full-size image of each done preview into the image cache (memory
// and disk, prefetch's default), so a tap on a finished tile draws at once.
// Thumbnails are not fetched: the grid loads them itself. A URL is fetched
// once while in flight or once it succeeded; one that failed is fetched again
// on the next delivery. A renewed signed URL is a new URL, so it is fetched
// too, which keeps a picker left open warm.
function previewPrefetcher() {
  const fetched = new Set<string>();
  return (previews: VisitPreview[]) => {
    for (const preview of previews) {
      const url = preview.status === 'done' && !preview.purgedAt ? preview.imageUrl : null;
      if (!url || fetched.has(url)) continue;
      fetched.add(url);
      Image.prefetch(url).then(
        (ok) => ok || fetched.delete(url),
        () => fetched.delete(url),
      );
    }
  };
}

// A look whose request failed before its row existed reads as failed, so a
// tap asks again.
function settle(look: LookPreview, unrequested: ReadonlySet<string>): LookPreview {
  return look.request && unrequested.has(requestKey(look.request)) ? { ...look, status: 'failed' } : look;
}
