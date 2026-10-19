import type { LineupState } from '@/engine/types';
import { CUSTOM_FAMILY } from '@/engine/constants';

const dataURL = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob);
});

/** Serialize computed artwork, not the editor. No server or screen-capture permission. */
export function createBrowserCapture(state: LineupState, { allProperties = false } = {}) {
  const assets = new Map<string, Promise<string>>();
  const embed = (url: string) => {
    if (url.startsWith('data:')) return Promise.resolve(url);
    if (!assets.has(url)) assets.set(url, fetch(url).then(r => { if (!r.ok) throw new Error('asset'); return r.blob(); }).then(dataURL));
    return assets.get(url)!;
  };
  let fonts: Promise<string> | undefined;
  let fontSignature = '';
  const image = new Image();
  const serializer = new XMLSerializer();
  let videoCanvas: HTMLCanvasElement | undefined;
  let properties: string[] = [];
  const expandedProperties = new Map<string, string[]>();
  const declaration = document.createElement('span').style;
  const captureProperties = (root: HTMLElement) => {
    const available = [...getComputedStyle(root)].filter(key => !key.startsWith('--') && !key.startsWith('animation') && !key.startsWith('transition'));
    if (allProperties) return available;
    // Read the properties this document can change, rather than hundreds of unused
    // browser features. Values are still recomputed on every node and every frame.
    const used = new Set(['display', 'width', 'height', 'direction', 'writing-mode', 'text-orientation', 'visibility', 'opacity', 'transform', 'transform-origin']);
    const collectStyle = (style: CSSStyleDeclaration) => { for (const key of style) used.add(key); };
    const visited = new Set<CSSStyleSheet>();
    const collectRules = (rules: CSSRuleList) => {
      for (const rule of rules) {
        if ('style' in rule) collectStyle((rule as CSSStyleRule).style);
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
      if (!(animation.effect instanceof KeyframeEffect)) continue;
      for (const frame of animation.effect.getKeyframes()) {
        for (const key of Object.keys(frame)) {
          if (['offset', 'computedOffset', 'easing', 'composite'].includes(key)) continue;
          used.add(key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase()));
        }
      }
    }
    // SVG images have different default typography from HTML documents, and lose
    // language inherited from ancestors. Preserve these even without author CSS.
    return used.has('all') ? available : available.filter(key => {
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
  };
  const styleText = (source: CSSStyleDeclaration) => {
    let css = '';
    for (const key of properties) css += `${key}:${source.getPropertyValue(key)};`;
    return css + 'animation:none!important;transition:none!important;';
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
      if (font) embedded.push(`@font-face{font-family:"${CUSTOM_FAMILY[role]}";src:url("${font.data}")}`);
    }
    return embedded.join('\n');
  };
  return async (root: HTMLElement, width: number, height: number, target?: HTMLCanvasElement) => {
    root.getBoundingClientRect(); await document.fonts.ready;
    properties = captureProperties(root);
    const faces: string[] = [];
    document.fonts.forEach(face => { if (face.status === 'loaded') faces.push(`${face.family}:${face.weight}:${face.unicodeRange}`); });
    const signature = faces.join('|');
    if (!fonts || signature !== fontSignature) { fonts = fontCSS(); fontSignature = signature; }
    let sequence = 0;
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
      if (!(node instanceof Element)) return node.cloneNode(false);
      if (['SCRIPT', 'STYLE', 'LINK'].includes(node.tagName)) return document.createTextNode('');
      const computed = getComputedStyle(node);
      if (computed.display === 'none') return document.createTextNode('');
      let copy: Element;
      if (node instanceof HTMLVideoElement) {
        const c = videoCanvas ||= document.createElement('canvas');
        if (c.width !== node.videoWidth) c.width = node.videoWidth;
        if (c.height !== node.videoHeight) c.height = node.videoHeight;
        const context = c.getContext('2d')!;
        context.clearRect(0, 0, c.width, c.height); context.drawImage(node, 0, 0);
        copy = document.createElement('img'); copy.setAttribute('src', c.toDataURL());
      } else copy = node.cloneNode(false) as Element;
      if (copy instanceof HTMLElement || copy instanceof SVGElement) { copy.removeAttribute('style'); applyStyle(copy, computed); }
      if (node instanceof HTMLImageElement) copy.setAttribute('src', await embed(node.currentSrc || node.src));
      for (const pseudo of ['::before', '::after']) {
        const css = getComputedStyle(node, pseudo);
        if (['none', 'normal', ''].includes(css.content)) continue;
        applyStyle(copy, css, pseudo);
      }
      for (const child of node.childNodes) copy.appendChild(await clone(child));
      return copy;
    };
    const copy = await clone(root) as HTMLElement;
    copy.style.cssText += `;position:relative;left:0;top:0;margin:0;width:${width}px;height:${height}px;overflow:hidden;`;
    copy.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    const style = document.createElement('style'); style.textContent = await fonts + '\n' + pseudoRules.join('\n'); copy.prepend(style);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${serializer.serializeToString(copy)}</foreignObject></svg>`;
    try {
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); await image.decode();
      const canvas = target || document.createElement('canvas');
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const context = canvas.getContext('2d')!;
      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0);
      return canvas;
    } finally { image.removeAttribute('src'); }
  };
}
