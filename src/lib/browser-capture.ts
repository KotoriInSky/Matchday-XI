import type { LineupState } from '@/engine/types';
import { CUSTOM_FAMILY } from '@/engine/constants';

const dataURL = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob);
});

/** Serialize computed artwork, not the editor. No server or screen-capture permission. */
export function createBrowserCapture(state: LineupState) {
  const assets = new Map<string, Promise<string>>();
  const embed = (url: string) => {
    if (url.startsWith('data:')) return Promise.resolve(url);
    if (!assets.has(url)) assets.set(url, fetch(url).then(r => { if (!r.ok) throw new Error('asset'); return r.blob(); }).then(dataURL));
    return assets.get(url)!;
  };
  let fonts: Promise<string> | undefined;
  let fontSignature = '';
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
  return async (root: HTMLElement, width: number, height: number) => {
    root.getBoundingClientRect(); await document.fonts.ready;
    const faces: string[] = [];
    document.fonts.forEach(face => { if (face.status === 'loaded') faces.push(`${face.family}:${face.weight}:${face.unicodeRange}`); });
    const signature = faces.join('|');
    if (!fonts || signature !== fontSignature) { fonts = fontCSS(); fontSignature = signature; }
    let sequence = 0;
    const pseudoRules: string[] = [];
    const copyStyle = (source: CSSStyleDeclaration, target: CSSStyleDeclaration) => {
      for (const key of source) {
        if (key.startsWith('--') || key.startsWith('animation') || key.startsWith('transition')) continue;
        target.setProperty(key, source.getPropertyValue(key));
      }
      target.setProperty('animation', 'none', 'important');
      target.setProperty('transition', 'none', 'important');
    };
    const clone = async (node: Node): Promise<Node> => {
      if (!(node instanceof Element)) return node.cloneNode(false);
      if (['SCRIPT', 'STYLE', 'LINK'].includes(node.tagName)) return document.createTextNode('');
      const computed = getComputedStyle(node);
      if (computed.display === 'none') return document.createTextNode('');
      let copy: Element;
      if (node instanceof HTMLVideoElement) {
        const c = document.createElement('canvas'); c.width = node.videoWidth; c.height = node.videoHeight;
        c.getContext('2d')!.drawImage(node, 0, 0); copy = document.createElement('img'); copy.setAttribute('src', c.toDataURL());
      } else copy = node.cloneNode(false) as Element;
      if (copy instanceof HTMLElement || copy instanceof SVGElement) copyStyle(computed, copy.style);
      if (node instanceof HTMLImageElement) copy.setAttribute('src', await embed(node.currentSrc || node.src));
      for (const pseudo of ['::before', '::after']) {
        const css = getComputedStyle(node, pseudo);
        if (['none', 'normal', ''].includes(css.content)) continue;
        const id = `capture-${sequence++}`; copy.classList.add(id);
        const holder = document.createElement('span'); copyStyle(css, holder.style);
        pseudoRules.push(`.${id}${pseudo}{${holder.style.cssText}}`);
      }
      for (const child of node.childNodes) copy.appendChild(await clone(child));
      return copy;
    };
    const copy = await clone(root) as HTMLElement;
    copy.style.cssText += `;position:relative;left:0;top:0;margin:0;width:${width}px;height:${height}px;overflow:hidden;`;
    copy.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    const style = document.createElement('style'); style.textContent = await fonts + '\n' + pseudoRules.join('\n'); copy.prepend(style);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${new XMLSerializer().serializeToString(copy)}</foreignObject></svg>`;
    const image = new Image(); image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    canvas.getContext('2d')!.drawImage(image, 0, 0);
    return canvas;
  };
}
