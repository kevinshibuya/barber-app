# Barber

An in-chair tool for barbers: the client's photo is taken during the visit and the shop's catalog of hair and beard styles is previewed on that photo before the barber cuts.

## Language

**Visit**:
One client in the chair, from the first photo to the after photo. Every photo, preview and chosen look belongs to a visit.

**Angle**:
One of the four photos of the client taken in a visit: front, left, right, back. Front is required; the others are optional.
_Avoid_: Slot (the storage column), side, view

**Style**:
One entry of the catalog, on exactly one axis: a hair style or a beard style. Each has a name shown to the client, a reference image and a rendering instruction.

**Keep**:
The style on each axis that means "leave it as it is". A look with keep on both axes is the untouched photo.
_Avoid_: None, original, unchanged

**Look**:
A pair of one hair style and one beard style. The barber browses looks and chooses one; "Manter como está" is a look with keep on both axes.
_Avoid_: Visual (the UI word, Portuguese), combination, variant

**Combination**:
A look where neither axis is keep. Today a combination is rendered on demand; the goal is for it to need no new render.

**Preview**:
The rendered image of one look on one angle. A visit has at most one preview per look per angle.
_Avoid_: Render (the act of producing a preview), generation, result

**Pre-render**:
Rendering previews before the barber asks for them, so that opening the picker or an angle shows finished images.

**Chosen look**:
The look the barber committed to in front of the client. It can be changed until the visit is locked.

**Locked**:
The state of a visit once the after photo exists or the visit is closed: its chosen look no longer changes.

**Drift**:
A preview that changes anything other than the styled region: another face, pose, background, clothing or lighting. A preview with drift is a defect, never shown as a style.
_Avoid_: Hallucination

**Region**:
The area of a photo a style is allowed to change: the hair region or the beard region. Everything outside a style's region stays the original photo.

**Mask**:
The pixel shape of a region on one angle photo. A hair mask and a beard mask exist per angle; they never overlap, and the sideburn belongs to the hair mask down to the earlobe line.

**Composite**:
A preview assembled from the original photo and one region taken from each rendered style, instead of rendered as a whole.

**Drift gate**:
The check every render passes before it becomes a preview: the face must be the same person and sit in the same place as in the original photo.
