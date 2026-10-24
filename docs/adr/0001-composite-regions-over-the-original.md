---
status: accepted
date: 2026-10-23
---

# Previews are composited by region over the original photo

Every style renders as a whole-image edit of the original photo on Nano Banana 2.1, the bake-off winner on keeping the person, and the worker then pastes only that style's region (hair or beard, masked per angle) back over the original. A hair plus beard look is two region pastes over the original, so 17 renders cover every look on an angle and no render is ever an edit of an edit. We chose this over a masked inpainting endpoint (FLUX Fill, Stability, Ideogram) because identity preservation measured in the bake-off matters more than native mask support, and because the compositing step gives the pixel guarantee outside the region on any provider, including a future one.

## Considered options

- **Masked endpoint per style.** Native mask and seed, paste-back built in on some endpoints. Rejected for now: FLUX lost the person in the bake-off, and a provider switch would redo the bake-off. It stays the fallback if composited seams fail on real photos.
- **Chained edits for combinations** (the previous design: beard prompt on top of the hair render). Rejected: every hop compounds drift, and a combination still costs a render and fifteen seconds.
- **Compositing on the phone.** Instant, but a new image-processing dependency in the app and the client page could not show a combination. Rejected in favour of the worker assembling every pair as a stored preview.

## Consequences

- Masks are computed once per angle photo, on upload, from a text-prompted segmenter (SAM 3 or EVF-SAM on fal) with a geometric fallback for bald and clean-shaven clients. The hair region owns the sideburn down to the earlobe line.
- A whole-image render may shift framing; the drift gate rejects a render whose face does not sit where the original's does, so pasting never misaligns.
- Regions must cover where hair or beard could be, not where it is, or a longer style is clipped at the seam.
