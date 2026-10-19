/** Compare decoded pixels; separate compositor rounding from visible rendering changes. */
export async function pixelDifference(page, before, after) {
  return page.evaluate(async urls => {
    const images = await Promise.all(urls.map(async src => {
      const img = new Image(); img.src = src; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
      canvas.getContext('2d').drawImage(img, 0, 0);
      return { width: img.width, height: img.height, data: canvas.getContext('2d').getImageData(0, 0, img.width, img.height).data };
    }));
    if (images[0].width !== images[1].width || images[0].height !== images[1].height) return { changed: Infinity, maxDelta: Infinity };
    let changed = 0, maxDelta = 0;
    for (let i = 0; i < images[0].data.length; i++) {
      const delta = Math.abs(images[0].data[i] - images[1].data[i]);
      if (delta) changed++;
      maxDelta = Math.max(maxDelta, delta);
    }
    return { changed, maxDelta };
  }, [before, after].map(bytes => 'data:image/png;base64,' + bytes.toString('base64')));
}
