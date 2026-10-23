-- The global catalog, seeded as data so a prompt or reference image changes
-- without an app release. Reference images are `<dimension>/<slug>.png` in the
-- public `styles` bucket. Every prompt keeps the client's natural hair texture.
-- Re-running inserts nothing: an edited row is never overwritten here.

insert into public.styles (dimension, slug, name, reference_image_path, prompt, sort_order)
select
  catalog.dimension::public.style_dimension,
  catalog.slug,
  catalog.name,
  catalog.reference_image_path,
  case catalog.dimension
    when 'hair' then catalog.prompt || ' Keep the person''s natural hair texture and hair color.'
      || ' Keep their face, facial hair, skin tone, expression, clothing, lighting and background unchanged.'
      || ' The result is a photorealistic barbershop photo.'
    else catalog.prompt || ' Keep the hair on their head exactly as it is, with its natural hair texture and color.'
      || ' Keep their face, skin tone, expression, clothing, lighting and background unchanged.'
      || ' The result is a photorealistic barbershop photo.'
  end,
  catalog.sort_order
from (values
  ('hair', 'keep', 'Manter como está', null, null, 0),
  ('hair', 'buzz-cut', 'Raspado na máquina', 'hair/buzz-cut.png',
    'Give the person a buzz cut: hair clipped to an even, very short length all over the head, following the natural hairline.', 1),
  ('hair', 'crew-cut', 'Corte social', 'hair/crew-cut.png',
    'Give the person a crew cut: short tapered back and sides with slightly longer hair on top, neatly groomed.', 2),
  ('hair', 'low-fade', 'Degradê baixo', 'hair/low-fade.png',
    'Give the person a low fade: the sides and back fade from skin just above the ears and neckline into short hair, with the top left at a medium length.', 3),
  ('hair', 'mid-fade', 'Degradê médio', 'hair/mid-fade.png',
    'Give the person a mid fade: the sides and back fade from skin at the temple line into short hair, with the top left at a medium length.', 4),
  ('hair', 'high-skin-fade', 'Degradê navalhado alto', 'hair/high-skin-fade.png',
    'Give the person a high skin fade: the sides and back shaved to the skin up to the top of the head and blended into a short top.', 5),
  ('hair', 'taper', 'Taper', 'hair/taper.png',
    'Give the person a taper: the hair gradually shortens only at the sideburns and the nape, the rest of the cut kept at a natural medium-short length.', 6),
  ('hair', 'textured-crop', 'Crop texturizado', 'hair/textured-crop.png',
    'Give the person a textured crop: short faded sides and a choppy, textured top pushed forward into a short fringe.', 7),
  ('hair', 'french-crop-fringe', 'French crop com franja', 'hair/french-crop-fringe.png',
    'Give the person a French crop: short sides and a short top combed forward into a straight, blunt fringe across the forehead.', 8),
  ('hair', 'quiff', 'Topete', 'hair/quiff.png',
    'Give the person a quiff: short sides and a longer top swept upward and back at the front.', 9),
  ('hair', 'pompadour', 'Pompadour', 'hair/pompadour.png',
    'Give the person a pompadour: short sides and a long top styled up and back with volume at the front.', 10),
  ('hair', 'side-part', 'Risca lateral', 'hair/side-part.png',
    'Give the person a side part: short tapered sides and a medium top combed to one side from a clean part line.', 11),
  ('hair', 'slick-back', 'Penteado para trás', 'hair/slick-back.png',
    'Give the person a slick back: short sides and a medium-length top combed straight back from the forehead.', 12),
  ('beard', 'keep', 'Manter como está', null, null, 0),
  ('beard', 'clean-shaven', 'Barba feita', 'beard/clean-shaven.png',
    'Remove all facial hair so the person is clean shaven, with realistic skin where the beard was.', 1),
  ('beard', 'stubble', 'Barba por fazer', 'beard/stubble.png',
    'Give the person even short stubble of a few days'' growth across the jaw, chin, cheeks and upper lip.', 2),
  ('beard', 'short-boxed', 'Barba curta quadrada', 'beard/short-boxed.png',
    'Give the person a short boxed beard: trimmed short and even, with a clean cheek line and a squared-off jawline.', 3),
  ('beard', 'full-beard', 'Barba cheia', 'beard/full-beard.png',
    'Give the person a full beard: dense facial hair covering the jaw, chin, cheeks and upper lip, neatly shaped.', 4),
  ('beard', 'goatee', 'Cavanhaque', 'beard/goatee.png',
    'Give the person a goatee: hair on the chin and around the mouth only, with the cheeks and jaw shaved.', 5)
) as catalog (dimension, slug, name, reference_image_path, prompt, sort_order)
on conflict (dimension, slug) do nothing;
