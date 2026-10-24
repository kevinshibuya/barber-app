Approved: 2026-10-22, by the product owner, in the #13 session.

# Picker screen: references

The picker tickets (#14, #15) build from this doc. Every element of the picker traces to a row below: the spine, a named graft, or the spec (#1). Anything that traces to none of them is cut, not restyled.

## References

All four are App Store listing screenshots, fetched on 2026-10-22 through the iTunes lookup API at full resolution. They are marketing frames, so each shows a finished state; none shows a loading tile.

| # | File | App | Listing | Screen |
|---|---|---|---|---|
| 1 | `references/1-zepeto-avatar-editor.jpg` | ZEPETO: Avatar, Connect & Live (NAVER Z) | https://apps.apple.com/us/app/id1350301428 | Screenshot 2, "Endless Looks and Items": the avatar editor |
| 2 | `references/2-fadelogic-explore-grid.jpg` | FadeLogic (ELYON AI) | https://apps.apple.com/us/app/id6746824450 | Screenshot 2, "40+ Styles to Explore": the Explore grid |
| 3 | `references/3-youcam-hairstyle-try-on.jpg` | YouCam Makeup (Perfect Mobile) | https://apps.apple.com/us/app/id863844475 | Screenshot 5, "Hairstyle Try On" |
| 4 | `references/4-glowify-beard.jpg` | Glowify - AI Hairstyle Try On (Flarial Interactive) | https://apps.apple.com/us/app/id6751491972 | Screenshot 7, "Find Your Best Beard Style": the Beard screen |

Looked at and not used: Bitmoji (its editor shows clothing icons, not the user's face, and its other screens are stickers and chat), Beardd (its grids are marketing composites with no app chrome), the rest of the FadeLogic and Glowify screens (face scores, colour analysis).

## Anatomy

### 1. ZEPETO avatar editor

- **Layout:** two stacked regions. The top ~60% of the visible screen is the preview: the avatar on a flat light-blue backdrop, bleeding to both side edges and the top. The bottom ~40% is a white sheet holding the tabs and the grid. The preview stays fixed and the grid scrolls under the tab row.
- **Header:** none. The preview runs to the top edge.
- **Tabs:** one horizontal, scrollable row of text tabs (Top, Pants, Skirt, Dress, Accessories), preceded by two icon buttons (search, heart). The selected tab is bold and near-black with a short near-black underline bar the width of the word; the others are regular weight in mid grey. A full-width hairline divider sits under the row. A second row of text sub-tabs (All, T-shirts, Shirts, Hoodie, Crop Top) sits below it: selected is near-black, the others grey, with no underline.
- **Grid:** 5 columns of cut-out item images on the white sheet, with no tile container, background or caption. Items are square.
- **Selected state:** a rounded-rect outline, ~3 pt, in the accent violet, radius ~12, around the selected item. No fill change and no checkmark.
- **Primary action:** one pill, "Buy 1", floating over the bottom-right corner of the preview, just above the sheet. Solid accent-violet fill, white bold label, fully rounded ends.
- **Colour roles:** the accent violet is used for exactly two things, the primary action fill and the selected outline. Tabs use the text colour, not the accent. The sheet is white and the preview backdrop is a flat tint.
- **Shape vocabulary:** flat, borderless regions; the only drawn shapes are the pill and the selection outline.
- **Density:** preview, one pill, two tab rows, about ten visible items.

### 2. FadeLogic Explore grid

- **Tiles:** 3 columns of portrait tiles, aspect about 2:3, radius ~12, with ~8 pt gutters. The photo fills the whole tile: the same person, in profile, wearing each style.
- **Caption:** overlaid on the bottom of the photo, over a dark gradient scrim rising from the bottom edge. Line 1 is the style name, white, medium weight. Line 2 is a short status in small caps, coloured ("84 FIT", in green).
- **Other:** an outline heart icon in each tile's top-right corner, a search field, filter chips (All, Trending, Curly, Wavy, Short), and section headers with "See All" links. All of them are cut (see the absence list).
- **Ground:** near-black, with purple accents.

### 3. YouCam Hairstyle Try On

- **Preview:** the photo bleeds to all four edges. No frame, no inset, no rounded corners.
- **Controls:** a horizontal strip of tiles overlaid directly on the photo along the bottom edge, with no bar or container behind it. The selected tile has a ~4 pt pink outline and radius ~16.
- **Other:** a vertical before/after split line through the face. Cut.

### 4. Glowify Beard screen

- **Header:** a back arrow at the left and the screen title centred ("Beard"), white on near-black, no bar container and no divider.
- **Below it:** a large inset photo, a "More Beard" label, a horizontal strip of face tiles with names under them (selected: a white outline), and a full-width rounded-rect "Create Your Look" button. Only the header is used.

## Spine

**Reference 1, the ZEPETO avatar editor.** It is the one reference that is a character-creation screen: the current look lives in a big preview, the options sit in tabs and a grid below it, and tapping an option changes the preview in place. The picker follows that structure:

- **Preview** (top ~60%): the current look on the client, that is, the selected hair plus the selected beard, cover-cropped to the region and bleeding to both sides and the top. Tapping it opens the full-screen preview.
- **Primary action:** the choose button is the spine's floating pill, at the preview's bottom-right corner just above the sheet. It uses the accent fill with a white bold label.
- **Tabs:** one text-tab row with two tabs, `Cabelo` and `Barba`. Selected is bold with the short underline bar; unselected is grey. A hairline divider sits under the row.
- **Grid:** scrolls under the fixed preview and tab row.
- **Selected tile:** the spine's accent outline, ~3 pt, radius matching the tile, with no fill change and no checkmark.
- **Colour roles:** one accent hue, used only for the choose pill and the selected outline. Tabs and text use the text colour. The hue itself comes from the app's theme in the scaffold (#4), not from this doc.

Deliberate deltas from the spine:

- The search and heart icons and the sub-tab row are cut. There are two dimensions and 13 and 6 tiles, so nothing needs filtering.
- The 5-column item grid becomes 3 columns of photo tiles (graft A). Faces need the width.

## Grafts

| Graft | Element | From | Replaces in the spine |
|---|---|---|---|
| A | Tile anatomy: 3 columns, portrait aspect about 2:3, radius ~12, ~8 pt gutters, photo fills the tile | Reference 2, FadeLogic | ZEPETO's 5-column borderless cut-outs |
| B | Two-line caption overlaid on the bottom of the tile over a dark gradient scrim: line 1 the style name in white medium weight, line 2 a short status line. The status line carries the filling-in, failed and refused states (below) | Reference 2, FadeLogic (the "84 FIT" line, repurposed for status) | ZEPETO has no captions |
| C | Full-screen preview: the photo bleeds to all four edges, and controls sit directly on the photo with no bar behind them | Reference 3, YouCam | ZEPETO has no full-screen view |
| D | Picker header: back arrow at the left and a centred title, with no bar and no divider, overlaid on the top of the preview in white | Reference 4, Glowify | ZEPETO has no header |

## Picker states

Each state names its source. "Spec" means a user story or implementation decision in #1.

### Tabs for hair and beard

`Cabelo` and `Barba`, in the spine's tab row. `Cabelo` is selected when the picker opens, since hair renders first (spec, story 51). The selection on each tab persists while switching: the preview always shows the hair selection plus the beard selection.

### Tile grid

The tile order is the catalog's sort order, with the keep tile first. Each tile is graft A plus the graft B caption.

- **Reference image and name** (spec, story 33): until the client's preview exists, the tile shows the style's reference image, a neutral studio photo of a model wearing the style, with the style's name on line 1.
- **Filling in** (spec, stories 24 and 33): while the preview row is `pending` or `running`, the tile shows the reference image and the status line reads `Gerando…`, next to the component library's default activity indicator at caption size. When the row turns `done`, the tile's image swaps to the client's thumbnail and the status line disappears. No reference shows a loading tile; this state traces to the spec, and the indicator is a library primitive.
- **Failed** (spec, story 30): the reference image stays, and the status line reads `Falhou · toque para tentar`. Tapping the tile retries (the row resets to `pending`) and the tile goes back to filling in. Tapping a failed tile does not select it.
- **Refused** (spec, story 31): the reference image stays, and the status line reads `Indisponível`. A tap does nothing, and the tile is never retried or selected.
- **Keep tile** (spec, story 26): the first tile on each tab, named `Manter como está`. Its image is the client's front photo. It is never loading, failed or refused, since keep costs no generation.
- **Selected:** the spine's outline. One tile is selected per tab, and the keep tile is selected on both tabs when the picker opens.

### Preview region and the combination state

The preview shows the image for the current hair and beard pair (spec, story 29):

| Hair | Beard | Preview shows |
|---|---|---|
| keep | keep | the front photo |
| a style | keep | that hair preview (pre-rendered) |
| keep | a style | that beard preview (pre-rendered) |
| a style | a style | the combination render, requested on demand |

- **Combination pending:** while the combination row is `pending` or `running`, the preview shows the hair preview as its base (the combination renders on top of it, per the spec) with the library activity indicator and `Juntando cabelo e barba…` overlaid at the bottom-left, on the graft B scrim. The choose pill is disabled until the row is `done`.
- **Combination failed:** the hair preview stays, and the overlay reads `Falhou · toque para tentar`. Tapping the preview retries.
- **Combination refused:** the overlay reads `Indisponível para esta combinação`. The choose pill stays disabled.
- **Pair not ready:** if the single style selected is still filling in, the preview shows that style's reference image with the same overlay and `Gerando…`, and the choose pill is disabled.

### Full-screen preview with angle swipe

Opened by tapping the preview region. It uses graft C, with the controls laid on the photo:

- **Close:** the graft D back arrow at the top-left returns to the picker with the same selection.
- **Angles** (spec, story 28; spec #27): pages swipe horizontally in angle order `Frente`, `Esquerda`, `Direita`, `Trás`, and only the angles the visit has photos for appear. The angle pills, the same component as on the picker's photo, sit at the bottom-left on the graft B scrim: the current angle is filled white. A pill tap pages to its angle. Full screen opens on the picker's current angle and closes back to the angle it was on.
- **Angle filling in:** a non-front angle renders on demand when its page is first shown. Until it is `done`, the page shows that slot's original photo with the library activity indicator and `Gerando este ângulo…`, centred.
- **Angle failed or refused:** `Falhou · toque para tentar` (a tap retries) or `Indisponível`, in the same place.
- **Choose:** the spine's pill sits at the bottom-right, the same pill as in the picker. It chooses the look shown on the current page.

### The choose action

- **Pill label** (spec, stories 34 and 35): `Escolher este visual`. When the pair on screen is already the visit's chosen look, the label reads `Visual escolhido` and the pill is disabled. Changing either selection re-enables it.
- **Disabled:** whenever the preview for the pair on screen is not `done`, as above.
- **Save failure:** a toast from the library reading `Não deu para salvar a escolha. Tente de novo.`

### Header

Graft D, overlaid on the top of the preview in white:

- **Left:** the back arrow returns to the visit.
- **Centre:** the client's name.
- **Right:** a text button, `Finalizar`, that goes to the finish screen (spec, the screen list: picker, then finish). The spec requires this action and no reference shows it, so it takes the library's text-button default.

## Absence list

These are not in the picker, though a build would normally reach for them:

- Skeleton shimmer or placeholder blocks on loading tiles. The reference image is the placeholder.
- Favourite hearts, fit scores and percentages (reference 2).
- Search fields, filter chips, sub-tabs, and section headers with "See All" links (references 1 and 2).
- The before/after split slider (reference 3). It is not in the spec. If the product owner wants a compare against the original photo, it becomes a new ticket.
- A bottom navigation bar, badges ("Novo", "Popular"), counters, prices.
- Drop shadows on tiles, gradient screen backgrounds, a glow on the selected tile.
- A checkmark badge on the selected tile. The outline is the whole selected state.
- Confetti or an animation on choose, and onboarding tooltips.
- A second call to action beside the choose pill.
- A dark or light toggle.

## Strings (pt-BR)

These go in the app's one strings file.

| Key | pt-BR | Where |
|---|---|---|
| `picker.tab.hair` | Cabelo | tab |
| `picker.tab.beard` | Barba | tab |
| `picker.tile.keep` | Manter como está | keep tile name |
| `picker.tile.generating` | Gerando… | tile status line |
| `picker.tile.failed` | Falhou · toque para tentar | tile status line, combination and angle overlays |
| `picker.tile.refused` | Indisponível | tile status line, angle overlay |
| `picker.preview.combining` | Juntando cabelo e barba… | combination pending overlay |
| `picker.preview.comboRefused` | Indisponível para esta combinação | combination refused overlay |
| `picker.angle.front` | Frente | angle pill |
| `picker.angle.left` | Esquerda | angle pill |
| `picker.angle.right` | Direita | angle pill |
| `picker.angle.back` | Trás | angle pill |
| `picker.angle.generating` | Gerando este ângulo… | angle pending overlay |
| `picker.choose` | Escolher este visual | choose pill |
| `picker.chosen` | Visual escolhido | choose pill, current pair already chosen |
| `picker.chooseError` | Não deu para salvar a escolha. Tente de novo. | toast |
| `picker.finish` | Finalizar | header, right |
| `picker.a11y.back` | Voltar | back arrow accessibility label |
| `picker.a11y.openPreview` | Ver em tela cheia | preview region accessibility label |
| `picker.a11y.angles` | Ângulos | angle pills accessibility label |
