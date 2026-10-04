/**
 * The face's appearance now lives with the tokens it consumes, in `src/shared/theme.ts`.
 *
 * It moved because it was in the wrong place, and the mistake was invisible for several milestones. The
 * stylesheet was inlined into the preview **page**, while `renderFace()` embedded only the custom-property
 * block — so the class names travelled with the SVG and the rules that give them appearance did not. The
 * preview looked right; the widget, and any SVG opened on its own, had no colours at all.
 *
 * This module is kept as a re-export rather than deleted so the preview page keeps working unchanged, and
 * so nothing has to remember which of the two files holds the stylesheet. There is exactly one copy.
 */
export { FACE_CSS } from '../shared/theme.ts';
