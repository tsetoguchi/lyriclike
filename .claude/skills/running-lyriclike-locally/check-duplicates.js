// Fails when two controls with the same name are on screen at once.
// Screenshots miss this when the copies are stacked in one spot, so it
// measures instead. Run with browser_run_code_unsafe, filename = this file.
async (page) => {
  const CONTROL_SELECTOR = 'button, a[href], [role="button"], [role="tab"]';
  const MIN_SIZE_PX = 1;

  const found = await page.evaluate(([selector, minSize]) => {
    function is_rendered(el) {
      for (let node = el; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (Number(style.opacity) === 0) return false;
      }
      return true;
    }

    function is_on_screen(rect) {
      if (rect.width < minSize || rect.height < minSize) return false;
      return rect.bottom > 0 && rect.right > 0
        && rect.top < innerHeight && rect.left < innerWidth;
    }

    // Visible text first: two copies can carry different aria-labels
    // ("Invite" and "Invite a friend") while a person sees the same word.
    function name_of(el) {
      const label = el.innerText.trim() || el.getAttribute('aria-label') || '';
      return label.replace(/\s+/g, ' ').trim();
    }

    const groups = {};
    for (const el of document.querySelectorAll(selector)) {
      const rect = el.getBoundingClientRect();
      const name = name_of(el);
      if (!name || !is_on_screen(rect) || !is_rendered(el)) continue;
      const where = `${el.id ? '#' + el.id : el.className}`
        + ` @${Math.round(rect.left)},${Math.round(rect.top)}`;
      (groups[name] ||= []).push(where);
    }
    const duplicates = Object.entries(groups).filter(([, list]) => list.length > 1);
    return { width: innerWidth, scrollY: Math.round(scrollY), duplicates };
  }, [CONTROL_SELECTOR, MIN_SIZE_PX]);

  return { ok: found.duplicates.length === 0, ...found };
}
