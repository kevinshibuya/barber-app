import { ConnectivityIndicator } from '@/components/connectivity-indicator';
import { FormError } from '@/components/form-error';
import { FullScreenPreview } from '@/components/full-screen-preview';
import { ChoosePill, LookStatus } from '@/components/look-status';
import { PickerTile } from '@/components/picker-tile';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
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
import { ActivityIndicator, Image, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// The header's scrim, darkest at the top edge, so its white text reads on any photo.
const HEADER_SCRIM = { backgroundImage: 'linear-gradient(to bottom, rgba(0, 0, 0, 0.55), transparent)' };
const GRID_PADDING = 16;
const GRID_GAP = 8;

interface PickerData {
  visit: Visit;
  clientName: string;
  catalog: Catalog;
  frontPhotoUrl: string | null;
  // The uploaded photos in slot order: the full-screen preview's pages.
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
  const front = angles.find((angle) => angle.slot === 'front');
  return { visit, clientName: found.name, catalog, frontPhotoUrl: front?.url ?? null, angles };
}

// The picker of a visit, after docs/design/picker-references.md: the selected
// look large on top (the spine's preview, with graft D's header and the
// floating choose pill), and below it the hair and beard tabs over a grid of
// tiles that fill in as the visit's previews render. Tapping the look opens
// it full screen, across the visit's other angles. Combinations and other
// angles render on demand, requested the first time they are shown.
export default function PickerScreen() {
  const router = useRouter();
  const { id: visitId } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const [data, setData] = useState<PickerData | null>(null);
  const [failed, setFailed] = useState(false);
  const [previews, setPreviews] = useState<VisitPreview[]>([]);
  const [tab, setTab] = useState<StyleDimension>('hair');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [fullScreen, setFullScreen] = useState(false);
  const [page, setPage] = useState(0);
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

  useEffect(() => subscribeToPreviews(visitId, setPreviews), [visitId]);

  // The look on the front, which the picker shows, and on every angle, which
  // the full-screen pages show.
  const front =
    data && selection
      ? settle(lookFor(selection, data.catalog, previews, 'front', data.frontPhotoUrl), unrequested)
      : null;
  const looks =
    data && selection
      ? data.angles.map((angle) =>
          settle(lookFor(selection, data.catalog, previews, angle.slot, angle.url), unrequested),
        )
      : [];
  const shown = [front, fullScreen ? looks[page] : null];

  // Asks once for each on-demand look shown without a row; a retry asks again.
  useEffect(() => {
    for (const look of shown) {
      if (look?.request && !requested.current.has(requestKey(look.request))) void request(look.request);
    }
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

  const { visit, catalog, frontPhotoUrl } = data;
  const look = front!;
  // A recorded look has its preview, unless it is keep with keep, which has none.
  const keepBoth = selection.hair === catalog.keep.hair.id && selection.beard === catalog.keep.beard.id;
  const chosen =
    visit.chosenHairStyleId === selection.hair &&
    visit.chosenBeardStyleId === selection.beard &&
    (keepBoth || visit.chosenPreviewId !== null);
  // Once the after photo is taken, or the visit closed, the look is the record.
  const locked = visit.afterPhotoPath !== null || visit.status === 'closed';
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

  function openFullScreen() {
    setPage(0);
    setFullScreen(true);
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
          page={page}
          onPage={setPage}
          onClose={() => setFullScreen(false)}
          onRetry={retryLook}
          choose={pill}
        />
      )}
      <View className="bg-muted flex-[3] justify-between">
        <Pressable
          role="button"
          accessibilityLabel={strings.picker.a11y.openPreview}
          disabled={looks.length === 0}
          onPress={openFullScreen}
          className="absolute inset-0"
        >
          {look.imageUrl && (
            <Image
              testID="look-image"
              source={{ uri: look.imageUrl }}
              resizeMode="cover"
              className="absolute inset-0"
            />
          )}
        </Pressable>
        <SafeAreaView edges={['top']} style={HEADER_SCRIM} className="flex-row items-center px-2 pb-6">
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
        </SafeAreaView>
        <View className="flex-row items-end justify-between gap-3 p-3">
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
        <ScrollView contentContainerStyle={{ padding: GRID_PADDING, gap: GRID_GAP }} contentContainerClassName="flex-row flex-wrap">
          {tilesFor(tab, catalog, previews, frontPhotoUrl).map((tile) => (
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

// A look whose request failed before its row existed reads as failed, so a
// tap asks again.
function settle(look: LookPreview, unrequested: ReadonlySet<string>): LookPreview {
  return look.request && unrequested.has(requestKey(look.request)) ? { ...look, status: 'failed' } : look;
}
