/* Uploads: each reads the file in the browser, shrinks it to a sensible size and stores it in the lineup. */
import { CUSTOM_FAMILY, newFit } from '@/engine/constants';
import { registerFont } from '@/engine/fonts';
import { toast } from '@/components/Toaster';
import { imageShape, pickFile, readDataURL, readImage, readPhoto } from './images';
import { getStage } from './stage-instance';
import { store } from './store';

const IMAGE = 'image/*';
const unreadable = () => toast('photo.unreadable', { error: true });

export async function uploadPlayerPhoto(i: number, slot: 'photo' | 'photo2' | 'photoK') {
  const file = await pickFile(IMAGE);
  if (!file) return;
  try {
    const r = await readPhoto(file, slot === 'photo2' ? 500 : 1200);
    store.update((s) => {
      const p = s.players[i];
      if (slot === 'photo') {
        Object.assign(p, { photo: r.data, cut: r.cut, res: r.res, fit: newFit() });
        if (!p.photo2) p.fitS = newFit();
      } else if (slot === 'photoK') {
        Object.assign(p, { photoK: r.data, cutK: r.cut, fitK: newFit(), key: true });
      } else {
        Object.assign(p, { photo2: r.data, cutS: r.cut, fitS: newFit() });
      }
    });
  } catch {
    unreadable();
  }
}

export async function uploadCoachPhoto() {
  const file = await pickFile(IMAGE);
  if (!file) return;
  try {
    const r = await readPhoto(file, 1200);
    store.update((s) => Object.assign(s.coach, { photo: r.data, cut: r.cut, res: r.res, fit: newFit() }));
  } catch {
    unreadable();
  }
}

export async function uploadCrest() {
  const file = await pickFile(IMAGE);
  if (!file) return;
  try {
    const data = await readImage(file, 600, 'image/webp');
    store.update((s) => { s.team.crest = data; s.team.crestFit = newFit(); });
  } catch {
    unreadable();
  }
}

export async function uploadBackground() {
  const file = await pickFile(IMAGE);
  if (!file) return;
  try {
    const data = await readImage(file, 2560, 'image/jpeg');
    store.update((s) => { s.bg.image = data; s.bg.mode = 'image'; s.bg.fit = newFit(); });
  } catch {
    unreadable();
  }
}

/** Background videos are too large to save, so they only last for this visit. */
export async function uploadVideo() {
  const file = await pickFile('video/*');
  if (!file) return;
  getStage()?.setVideo(URL.createObjectURL(file));
  store.update((s) => { s.bg.mode = 'video'; s.bg.fit = newFit(); });
}

export function removeBackgroundMedia() {
  getStage()?.setVideo(null);
  store.update((s) => {
    s.bg.image = null;
    if (s.bg.mode === 'image' || s.bg.mode === 'video') s.bg.mode = 'stripes';
  });
}

export async function uploadTag(id?: string) {
  const file = await pickFile(IMAGE);
  if (!file) return;
  try {
    const img = await readImage(file, 360, 'image/webp');
    const shape = await imageShape(img);
    if (id) {
      store.update((s) => {
        const tag = s.tags.find((x) => x.id === id);
        if (tag) { Object.assign(tag, { img, shape, fit: newFit() }); delete tag.fifaCode; }
      });
    } else {
      const label = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 24);
      store.update((s) => s.tags.push({ id: 't' + Date.now().toString(36), label, img, shape, fit: newFit() }));
      toast('tags.added');
    }
  } catch {
    unreadable();
  }
}

export async function uploadFont(role: 'display' | 'body' | 'number') {
  const file = await pickFile('.ttf,.otf,.woff,.woff2,font/*');
  if (!file) return;
  try {
    const ok = await registerFont(role, await file.arrayBuffer());
    if (!ok) throw new Error('font');
    const data = await readDataURL(file);
    store.update((s) => {
      s.customFonts[role] = { name: file.name, data };
      if (role === 'number') s.numberStyle = { font: CUSTOM_FAMILY.number, mode: s.numberStyle?.mode || 'solid' };
      else s.fonts[role] = CUSTOM_FAMILY[role];
    });
    toast('style.fontAdded', { vars: { name: file.name } });
  } catch {
    toast('style.fontError', { error: true });
  }
}
