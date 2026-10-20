import subsetWasm from 'harfbuzzjs/dist/harfbuzz-subset.wasm?url';

// Raw exports of HarfBuzz's standalone subsetter (harfbuzzjs, MIT). The module
// has no imports; it is fetched only when an export embeds fonts.
type Subsetter = {
  memory: WebAssembly.Memory;
  malloc(size: number): number;
  free(pointer: number): void;
  hb_blob_create(data: number, length: number, mode: number, userData: number, destroy: number): number;
  hb_blob_destroy(blob: number): void;
  hb_blob_get_data(blob: number, length: number): number;
  hb_blob_get_length(blob: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(face: number): void;
  hb_face_reference_blob(face: number): number;
  hb_set_add(set: number, value: number): void;
  hb_set_clear(set: number): void;
  hb_set_invert(set: number): void;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(input: number): void;
  hb_subset_input_unicode_set(input: number): number;
  hb_subset_input_set(input: number, kind: number): number;
  hb_subset_or_fail(face: number, input: number): number;
};

let subsetter: Promise<Subsetter> | undefined;
const loadSubsetter = () => subsetter ||= (async () => {
  const response = await fetch(subsetWasm);
  if (!response.ok) throw new Error('subset');
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer());
  return instance.exports as unknown as Subsetter;
})().catch(error => { subsetter = undefined; throw error; });

type Woff2 = { decompress(data: Uint8Array): Uint8Array | false };
let woff2: Promise<Woff2> | undefined;
// HarfBuzz reads SFNT only; Google's WOFF2 decoder (wawoff2, MIT) unpacks it.
// Its Emscripten binding exports its Module only under Node, so the package
// entry never resolves in a browser. Run the binding with a Module we own; the
// WebAssembly is inlined as a data URI, so nothing else is fetched.
const loadWoff2 = () => woff2 ||= import('wawoff2/build/decompress_binding.js?raw')
  .then(({ default: binding }) => new Promise<Woff2>((resolve, reject) => {
    const module = { onRuntimeInitialized: () => resolve(module as unknown as Woff2), onAbort: reject };
    new Function('Module', binding)(module);
  }))
  .catch(error => { woff2 = undefined; throw error; });

const tag = (data: Uint8Array) => String.fromCharCode(...data.subarray(0, 4));

/**
 * Returns an SFNT font containing the glyphs for `codePoints`, plus every
 * OpenType layout feature so CSS features, ligatures and kerning are unchanged.
 * Throws for formats HarfBuzz cannot read (WOFF1, collections); callers embed
 * the original font then.
 */
export async function subsetFont(data: Uint8Array, codePoints: Iterable<number>): Promise<Uint8Array<ArrayBuffer>> {
  if (tag(data) === 'wOF2') {
    const sfnt = (await loadWoff2()).decompress(data);
    if (!sfnt) throw new Error('woff2');
    data = sfnt;
  }
  if (!['\0\x01\0\0', 'OTTO', 'true'].includes(tag(data))) throw new Error('font format');
  const hb = await loadSubsetter();
  const pointer = hb.malloc(data.byteLength);
  if (!pointer) throw new Error('subset memory');
  new Uint8Array(hb.memory.buffer).set(data, pointer);
  const blob = hb.hb_blob_create(pointer, data.byteLength, 2 /* HB_MEMORY_MODE_WRITABLE */, 0, 0);
  const face = hb.hb_face_create(blob, 0);
  hb.hb_blob_destroy(blob);
  const input = hb.hb_subset_input_create_or_fail();
  let subset = 0;
  try {
    if (!input) throw new Error('subset input');
    const unicodes = hb.hb_subset_input_unicode_set(input);
    for (const codePoint of codePoints) hb.hb_set_add(unicodes, codePoint);
    // HB_SUBSET_SETS_LAYOUT_FEATURE_TAG: an inverted empty set keeps all features.
    const features = hb.hb_subset_input_set(input, 6);
    hb.hb_set_clear(features); hb.hb_set_invert(features);
    subset = hb.hb_subset_or_fail(face, input);
    if (!subset) throw new Error('subset');
    const result = hb.hb_face_reference_blob(subset);
    try {
      const length = hb.hb_blob_get_length(result);
      if (!length) throw new Error('subset empty');
      // Read the view only now: memory may have grown during subsetting.
      return new Uint8Array(hb.memory.buffer, hb.hb_blob_get_data(result, 0), length).slice();
    } finally { hb.hb_blob_destroy(result); }
  } finally {
    if (input) hb.hb_subset_input_destroy(input);
    if (subset) hb.hb_face_destroy(subset);
    hb.hb_face_destroy(face);
    hb.free(pointer);
  }
}
