import styles from './stage.module.css';
import seasonStyles from './season2627.module.css';

/** A complete captain caption in the same frozen pose in the inspector and PNG. */
export function settleCardCaption(root: HTMLElement, caption: string) {
  for (const ticker of root.querySelectorAll<HTMLElement>(`.${styles['rc-ticker']} span, .${seasonStyles['s26-captain-text']}`)) {
    ticker.textContent = caption || 'Captain';
    ticker.style.setProperty('--caption-scale', '1');
    let scale = 1;
    for (let tries = 0; tries < 30 && ticker.scrollWidth > ticker.clientWidth + .5; tries++) {
      scale *= .9;
      ticker.style.setProperty('--caption-scale', String(scale));
    }
  }
}
