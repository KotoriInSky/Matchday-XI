import type { LineupState } from '@/engine/types';
import { CUSTOM_FAMILY } from '@/engine/constants';
import { subsetFont } from './font-subset';

const dataURL = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob);
});

/**
 * Whether CSS backface culling hides `node`. SVG foreignObject images and
 * HTML-in-Canvas snapshots flatten 3D faces and would paint a mirrored back
 * over the front, so captures cull such faces explicitly.
 */
export function backFacing(node: Element, css: CSSStyleDeclaration) {
  if (css.backfaceVisibility !== 'hidden') return false;
  const matrixFor = (style: CSSStyleDeclaration) => new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
  let matrix = matrixFor(css);
  // A face shares its parent's rotations only inside a preserve-3d context.
  // Use the platform matrix inverse, as specified for CSS backface culling.
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.transformStyle !== 'preserve-3d') break;
    matrix = matrixFor(style).multiply(matrix);
  }
  return matrix.inverse().m33 < 0;
}

/**
 * Serialize computed artwork, not the editor. No server or screen-capture permission.
 *
 * `imageHeadroom` enables per-frame image resampling: raster images are embedded
 * at their on-screen size times this factor instead of at full resolution. The
 * browser still performs the final downscale, so a factor of 3 keeps line art
 * visually indistinguishable while cutting most of the decode work.
 * `lightEncoding` percent-encodes only the characters a data URL requires.
 * `subsetFonts` embeds uploaded fonts reduced to the characters the artwork
 * displays. Built-in faces are already small unicode-range WOFF2 subsets.
 * `reuseUnchanged` skips decoding when a frame serializes exactly like the
 * previous one into the same target; callers must not draw on that target.
 */
export function createBrowserCapture(state: LineupState, { allProperties = false, pruneInvisible = false, imageHeadroom = 0, lightEncoding = false, subsetFonts: subsetRequested = false, reuseUnchanged = false } = {}, videoFrame?: () => string | undefined) {
  const subsetFonts = subsetRequested && Object.values(state.customFonts).some(Boolean);
  const assets = new Map<string, Promise<string>>();
  const embed = (url: string) => {
    if (url.startsWith('data:')) return Promise.resolve(url);
    if (!assets.has(url)) assets.set(url, fetch(url).then(r => { if (!r.ok) throw new Error('asset'); return r.blob(); }).then(dataURL));
    return assets.get(url)!;
  };
  // Resampled copies keyed by bucketed scale and source. Buckets are quarter
  // octaves, so an image zooming through a transition is re-encoded only a few
  // times. The cache lives as long as this capture, i.e. one export.
  // Nested by source, then scale: keying on `scale + src` would build and hash
  // a new multi-megabyte string per image and frame.
  const resampled = new Map<string, Map<number, Promise<string>>>();
  let resampling: Promise<string> = Promise.resolve(''), scratch: HTMLCanvasElement | undefined;
  const imageSource = async (node: HTMLImageElement) => {
    const src = node.currentSrc || node.src, url = await embed(src);
    const { naturalWidth: w, naturalHeight: h } = node;
    if (!imageHeadroom || !w || !h || url.startsWith('data:image/svg') || getComputedStyle(node).objectFit === 'none') return url;
    // The border box includes every ancestor transform. object-fit contain/cover
    // and fill never sample more than max(box / natural) source pixels per pixel.
    const box = node.getBoundingClientRect();
    const need = Math.max(box.width / w, box.height / h, 1 / 64) * imageHeadroom;
    const scale = 2 ** (Math.ceil(Math.log2(need) * 4) / 4);
    if (scale >= .75) return url; // Little to gain; keep the original pixels.
    let scales = resampled.get(src);
    if (!scales) resampled.set(src, scales = new Map());
    if (!scales.has(scale)) scales.set(scale, resampling = resampling.then(async (): Promise<string> => {
      const width = Math.max(1, Math.round(w * scale)), height = Math.max(1, Math.round(h * scale));
      // Canvas 'high' smoothing uses the same mipmapped filtering as image
      // painting; it kept line art sharper than createImageBitmap resizing.
      // One scratch canvas serves every resample of this export, in order.
      const canvas = scratch ||= document.createElement('canvas'); canvas.width = width; canvas.height = height;
      try {
        const context = canvas.getContext('2d')!; context.imageSmoothingQuality = 'high';
        context.drawImage(node, 0, 0, width, height);
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('png');
        return await dataURL(blob);
      } finally { canvas.width = canvas.height = 1; }
    }).catch(() => url)); // A failure keeps the original and the queue running.
    return scales.get(scale)!;
  };
  let fonts: Promise<string> | undefined;
  let fontSignature = '';
  // Code points the embedded font subsets cover. Starts with the whole stage
  // text, so a typical export subsets each face once; grows when a frame shows
  // a character outside it (and then every face is subset again).
  let covered: Set<number> | undefined;
  let coverage = 0;
  const subsets = new Map<string, Promise<{ url: string; subset: boolean }>>();
  const addCodePoints = (target: Set<number>, text: string) => {
    // Include case variants for text-transform; ASCII and typographic
    // punctuation cover ellipses, quotes and counters generated by CSS.
    for (const ch of text) for (const variant of [ch, ch.toUpperCase(), ch.toLowerCase()]) for (const c of variant) target.add(c.codePointAt(0)!);
  };
  const fontSource = (url: string): Promise<{ url: string; subset: boolean }> => {
    if (!covered) return embed(url).then(source => ({ url: source, subset: false }));
    const key = coverage + ' ' + url;
    if (!subsets.has(key)) subsets.set(key, (async (characters: Set<number>) => {
      const original = await embed(url);
      try {
        const data = new Uint8Array(await (await fetch(original)).arrayBuffer());
        const font = await subsetFont(data, characters);
        return { url: await dataURL(new Blob([font], { type: 'font/ttf' })), subset: true };
      } catch { return { url: original, subset: false }; }
    })(new Set(covered)));
    return subsets.get(key)!;
  };
  const image = new Image();
  let previous: { svg: string; target: HTMLCanvasElement } | undefined;
  const serializer = new XMLSerializer();
  let videoCanvas: HTMLCanvasElement | undefined;
  let properties: string[] = [];
  const resourceReferences = new Map<string, Set<Element | null>>();
  let unknownReferences = false;
  let resourcesIndexed = false;
  const reference = (id: string, owner: Element | null) => {
    try { id = decodeURIComponent(id); } catch { unknownReferences = true; return; }
    // Unusual/escaped fragment names need the complete reference path.
    if (!/^[\w-]+$/.test(id)) { unknownReferences = true; return; }
    if (!resourceReferences.has(id)) resourceReferences.set(id, new Set());
    resourceReferences.get(id)!.add(owner);
  };
  const collectReferences = (value: string, owner: Element | null) => {
    if (!pruneInvisible) return;
    // CSS escapes may spell a fragment without a literal '#'. Keep named
    // resources when a URL cannot be resolved conservatively from its text.
    if (/url\([^)]*\\/i.test(value)) unknownReferences = true;
    if (!value.includes('#')) return;
    for (const match of value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) {
      const url = (match[1] ?? match[2] ?? match[3]).trim(), hash = url.lastIndexOf('#');
      if (hash >= 0) reference(url.slice(hash + 1), owner);
    }
  };
  const indexResources = () => {
    if (resourcesIndexed) return;
    resourcesIndexed = true;
    const visited = new Set<CSSStyleSheet>();
    const collectSheet = (sheet: CSSStyleSheet) => {
      if (visited.has(sheet)) return;
      visited.add(sheet);
      for (const rule of sheet.cssRules) {
        collectReferences(rule.cssText, null);
        if (rule instanceof CSSImportRule && rule.styleSheet) collectSheet(rule.styleSheet);
      }
    };
    try { for (const sheet of [...document.styleSheets, ...document.adoptedStyleSheets]) collectSheet(sheet); }
    catch { unknownReferences = true; }
    for (const node of document.querySelectorAll('[style],[href],[*|href],[fill],[stroke],[filter],[clip-path],[mask]')) {
      for (const attribute of node.attributes) {
        collectReferences(attribute.value, node);
        if (attribute.localName === 'href' && attribute.value.includes('#')) {
          reference(attribute.value.slice(attribute.value.lastIndexOf('#') + 1), node);
        }
      }
    }
    for (const animation of document.getAnimations()) {
      if (!(animation.effect instanceof KeyframeEffect)) continue;
      for (const frame of animation.effect.getKeyframes()) {
        for (const value of Object.values(frame)) collectReferences(String(value), animation.effect.target);
      }
    }
  };
  const expandedProperties = new Map<string, string[]>();
  const declaration = document.createElement('span').style;
  // The set only grows during a capture: each stylesheet rule and animation is
  // read once (replaced or inserted rules are new objects), inline styles every
  // frame. A property used earlier stays captured: a superset, still exact.
  const used = new Set(['display', 'width', 'height', 'direction', 'writing-mode', 'text-orientation', 'visibility', 'opacity', 'transform', 'transform-origin']);
  const seenRules = new WeakSet<CSSRule>();
  const seenAnimations = new WeakSet<Animation>();
  let filtered: { size: number; available: number; list: string[] } | undefined;
  const captureProperties = (root: HTMLElement) => {
    const available = [...getComputedStyle(root)].filter(key => !key.startsWith('--') && !key.startsWith('animation') && !key.startsWith('transition'));
    if (allProperties) return available;
    // Read the properties this document can change, rather than hundreds of unused
    // browser features. Values are still recomputed on every node and every frame.
    const collectStyle = (style: CSSStyleDeclaration) => { for (const key of style) used.add(key); };
    const visited = new Set<CSSStyleSheet>();
    const collectRules = (rules: CSSRuleList) => {
      for (const rule of rules) {
        if (!seenRules.has(rule) && 'style' in rule) collectStyle((rule as CSSStyleRule).style);
        seenRules.add(rule);
        if (rule instanceof CSSImportRule && rule.styleSheet) collectSheet(rule.styleSheet);
        if ('cssRules' in rule) collectRules((rule as CSSGroupingRule).cssRules);
      }
    };
    const collectSheet = (sheet: CSSStyleSheet) => {
      if (visited.has(sheet)) return;
      visited.add(sheet); collectRules(sheet.cssRules);
    };
    try { for (const sheet of [...document.styleSheets, ...document.adoptedStyleSheets]) collectSheet(sheet); }
    catch { return available; } // Unreadable stylesheets require the full reference path.
    for (const node of document.querySelectorAll<HTMLElement | SVGElement>('[style]')) collectStyle(node.style);
    for (const animation of document.getAnimations()) {
      if (seenAnimations.has(animation) || !(animation.effect instanceof KeyframeEffect)) continue;
      seenAnimations.add(animation);
      for (const frame of animation.effect.getKeyframes()) {
        for (const key of Object.keys(frame)) {
          if (['offset', 'computedOffset', 'easing', 'composite'].includes(key)) continue;
          used.add(key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase()));
        }
      }
    }
    if (used.has('all')) return available;
    if (filtered?.size === used.size && filtered.available === available.length) return filtered.list;
    // SVG images have different default typography from HTML documents, and lose
    // language inherited from ancestors. Preserve these even without author CSS.
    const list = available.filter(key => {
      if (used.has(key) || /^(font-|text-|-webkit-text-)/.test(key)
        || ['line-height', 'letter-spacing', 'word-spacing', 'white-space', 'white-space-collapse', 'tab-size', '-webkit-locale'].includes(key)) return true;
      // CSS rules enumerate expanded longhands, while computed styles can expose
      // only a shorthand (e.g. background-position instead of its x/y properties).
      if (!expandedProperties.has(key)) {
        declaration.cssText = ''; declaration.setProperty(key, 'initial');
        expandedProperties.set(key, [...declaration]);
      }
      return expandedProperties.get(key)!.some(part => used.has(part));
    });
    filtered = { size: used.size, available: available.length, list };
    return list;
  };
  const styleText = (source: CSSStyleDeclaration) => {
    let css = '';
    for (const key of properties) css += `${key}:${source.getPropertyValue(key)};`;
    return css + 'animation:none!important;transition:none!important;';
  };
  const invisibleBox = (node: Element, css: CSSStyleDeclaration) => {
    // Export artwork has fixed-size, absolutely positioned layers. Keep their
    // computed layout boxes, but avoid serializing contents that cannot paint.
    // Normal-flow contents still contribute to sibling layout. Keep resources
    // used outside this subtree, including CSS and Web Animations references.
    if (!pruneInvisible || !(node instanceof HTMLElement)
      || (css.opacity !== '0' && css.visibility !== 'hidden')
      || !['absolute', 'fixed'].includes(css.position) || css.display === 'contents'
      || !css.width.endsWith('px') || !css.height.endsWith('px')) return false;
    const named = [...(node.id ? [node] : []), ...node.querySelectorAll('[id]')];
    if (named.length) indexResources();
    if (named.some(resource => unknownReferences || !/^[\w-]+$/.test(resource.id)
      || [...resourceReferences.get(resource.id) || []].some(owner => !owner || !node.contains(owner)))) return false;
    if (css.opacity === '0') return true;
    // Visibility can be restored by descendants and generated content, unlike
    // opacity. Recheck at every sample, including animation/loop boundaries.
    for (const child of [node, ...node.querySelectorAll('*')]) {
      if (child !== node && getComputedStyle(child).visibility === 'visible') return false;
      for (const pseudo of ['::before', '::after']) {
        const style = getComputedStyle(child, pseudo);
        if (style.visibility === 'visible' && !['none', 'normal', ''].includes(style.content)) return false;
      }
    }
    return true;
  };
  const fontCSS = async () => {
    // Embed only loaded faces; downloading every CJK unicode subset would be expensive.
    const loaded: FontFace[] = []; document.fonts.forEach(face => { if (face.status === 'loaded') loaded.push(face); });
    const normal = (s: string) => s.replace(/["']/g, '').trim().toLowerCase();
    const rangeKey = (s: string) => s.toLowerCase().replace(/\s+/g, '').replace(/\b0+([\da-f]+)/g, '$1');
    const sheets = await Promise.all([...document.styleSheets].map(async sheet => {
      let css: string;
      try { css = [...sheet.cssRules].map(rule => rule.cssText).join('\n'); }
      catch { if (!sheet.href) return []; const response = await fetch(sheet.href); if (!response.ok) throw new Error('font'); css = await response.text(); }
      // Relative font URLs belong to the stylesheet directory, including on Pages.
      return (css.match(/@font-face\s*\{[^}]+\}/g) || []).map(rule => ({ rule, base: sheet.href || document.baseURI }));
    }));
    const selected = sheets.flat().filter(({ rule }) => {
      const family = /font-family:\s*([^;]+)/.exec(rule)?.[1] || '';
      const range = /unicode-range:\s*([^;]+)/.exec(rule)?.[1];
      return loaded.some(face => normal(face.family) === normal(family) && (!range || rangeKey(face.unicodeRange) === rangeKey(range)));
    });
    const embedded = await Promise.all(selected.map(async ({ rule, base }) => {
      const urls = [...rule.matchAll(/url\(["']?([^\s)'" ]+)["']?\)/g)];
      for (const match of urls) rule = rule.replace(match[0], `url("${await embed(new URL(match[1], base).href)}")`);
      return rule;
    }));
    for (const role of ['display', 'body', 'number'] as const) {
      const font = state.customFonts[role];
      if (font) embedded.push(`@font-face{font-family:"${CUSTOM_FAMILY[role]}";src:url("${(await fontSource(font.data)).url}")}`);
    }
    return embedded.join('\n');
  };
  return async (root: HTMLElement, width: number, height: number, target?: HTMLCanvasElement) => {
    root.getBoundingClientRect(); await document.fonts.ready;
    resourceReferences.clear(); unknownReferences = resourcesIndexed = false;
    properties = captureProperties(root);
    const faces: string[] = [];
    document.fonts.forEach(face => { if (face.status === 'loaded') faces.push(`${face.family}:${face.weight}:${face.unicodeRange}`); });
    const signature = faces.join('|');
    let sequence = 0;
    let shown = ''; // Text and generated content in this frame, for font subsets.
    const pseudoRules: string[] = [];
    const sharedStyles = new Map<string, string>();
    const applyStyle = (copy: Element, css: CSSStyleDeclaration, pseudo = '') => {
      const text = styleText(css), key = pseudo + text;
      let id = sharedStyles.get(key);
      if (!id) {
        id = `capture-${sequence++}`; sharedStyles.set(key, id);
        pseudoRules.push(`.${id}${pseudo}{${text}}`);
      }
      copy.classList.add(id);
    };
    const clone = async (node: Node): Promise<Node> => {
      if (!(node instanceof Element)) {
        if (subsetFonts && node.nodeType === Node.TEXT_NODE) shown += (node as Text).data;
        return node.cloneNode(false);
      }
      if (['SCRIPT', 'STYLE', 'LINK'].includes(node.tagName)) return document.createTextNode('');
      const computed = getComputedStyle(node);
      if (computed.display === 'none') return document.createTextNode('');
      if (invisibleBox(node, computed)) {
        const copy = node.cloneNode(false) as HTMLElement;
        copy.removeAttribute('style'); applyStyle(copy, computed);
        return copy;
      }
      let copy: Element;
      if (node instanceof HTMLVideoElement) {
        copy = document.createElement('img');
        const supplied = videoFrame?.();
        if (supplied) copy.setAttribute('src', supplied);
        else {
          const c = videoCanvas ||= document.createElement('canvas');
          if (c.width !== node.videoWidth) c.width = node.videoWidth;
          if (c.height !== node.videoHeight) c.height = node.videoHeight;
          const context = c.getContext('2d')!;
          context.clearRect(0, 0, c.width, c.height); context.drawImage(node, 0, 0);
          copy.setAttribute('src', c.toDataURL());
        }
      } else copy = node.cloneNode(false) as Element;
      if (copy instanceof HTMLElement || copy instanceof SVGElement) { copy.removeAttribute('style'); applyStyle(copy, computed); }
      // SVG foreignObject image decoding flattens 3D faces and can paint a
      // mirrored back over the front. Cull that face explicitly in the copy,
      // retaining its layout and leaving the live animation untouched.
      if ((copy instanceof HTMLElement || copy instanceof SVGElement) && backFacing(node, computed)) copy.style.setProperty('opacity', '0', 'important');
      if (node instanceof HTMLImageElement) copy.setAttribute('src', await imageSource(node));
      for (const pseudo of ['::before', '::after']) {
        const css = getComputedStyle(node, pseudo);
        if (['none', 'normal', ''].includes(css.content)) continue;
        if (subsetFonts) shown += css.content + (css.content.includes('attr(') ? [...node.attributes].map(a => a.value).join('') : '');
        applyStyle(copy, css, pseudo);
      }
      for (const child of node.childNodes) copy.appendChild(await clone(child));
      return copy;
    };
    const copy = await clone(root) as HTMLElement;
    let extend = false;
    if (subsetFonts) {
      if (!covered) {
        covered = new Set(); extend = true;
        for (let c = 0x20; c < 0x7f; c++) covered.add(c);
        for (let c = 0x2010; c <= 0x203a; c++) covered.add(c);
        covered.add(0xa0); addCodePoints(covered, root.textContent || '');
      }
      for (const ch of shown) if (!covered.has(ch.codePointAt(0)!)) { addCodePoints(covered, shown); extend = true; break; }
      if (extend) { coverage++; subsets.clear(); }
    }
    if (!fonts || signature !== fontSignature || extend) { fonts = fontCSS(); fontSignature = signature; }
    copy.style.cssText += `;position:relative;left:0;top:0;margin:0;width:${width}px;height:${height}px;overflow:hidden;`;
    copy.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    const style = document.createElement('style'); style.textContent = await fonts + '\n' + pseudoRules.join('\n'); copy.prepend(style);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${serializer.serializeToString(copy)}</foreignObject></svg>`;
    // Object URLs would avoid the data URL, but Chromium taints the canvas for
    // foreignObject SVG loaded that way. Only '%', '#' and whitespace controls
    // must be escaped in a data URL; full encoding triples every '+', '/' and
    // '=' of the embedded base64 assets.
    // Identical markup rasterizes to identical pixels, which the target holds.
    if (reuseUnchanged && target && previous?.target === target && previous.svg === svg
      && target.width === width && target.height === height) return target;
    previous = undefined;
    const body = lightEncoding ? svg.replace(/[%#\t\n\r]/g, encodeURIComponent) : encodeURIComponent(svg);
    try {
      image.src = 'data:image/svg+xml;charset=utf-8,' + body; await image.decode();
      const canvas = target || document.createElement('canvas');
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const context = canvas.getContext('2d')!;
      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0);
      if (reuseUnchanged && target) previous = { svg, target };
      return canvas;
    } finally { image.removeAttribute('src'); }
  };
}
