---
name: style-form-controls
description: Style or fix Dashora search boxes, inputs, selects, textareas, and form controls. Use when adding controls in sidebars, boards, dashboards, dialogs, or pickers, especially when a box appears as an unstyled native browser field.
---

# Dashora form controls

Reuse the existing controls and theme tokens. Do not invent a separate visual
style or assume a class is styled independently of its ancestors.

## Choose the existing pattern

- **Standalone or compact search**, including sidebar and picker filters:
  use `class="search-box"`. It supplies the themed background, readable text and
  placeholder, UI font, padding, rounded border, and accent focus ring.
- **Full-width board or contact-list search with a search icon**:
  put `class="section-search"` inside `class="section-search-wrap"`.
  The wrapper supplies the icon and the input selectors require that ancestor.
  Never use `.section-search` alone.
- **Dialog fields**: use `.form-group` with a visible associated label.
  Its input, textarea, and select rules require that ancestor.
- **Standalone dropdowns**: reuse `.form-select`.
- **Descriptions and notes**: reuse the shared Markdown editor and renderer;
  do not replace them with a new plain-text-only widget.

### Compact search example

```html
<input class="search-box" type="search" id="boardFilter"
       aria-label="Search boards" placeholder="Search boards">
```

### Decorated search example

```html
<div class="section-search-wrap">
  <input class="section-search" type="search" id="itemFilter"
         aria-label="Search items" placeholder="Search items">
</div>
```

## Before changing code

1. Read the relevant selectors in [style.css](../../../css/style.css), including
   ancestor selectors, focus rules, theme overrides, and media queries.
2. Compare an existing working control in the same context. The main sidebar
   search in [index.html](../../../index.html) is the standalone reference;
   board search in [app.js](../../../js/app.js) is the decorated reference.
3. Keep IDs, labels, event handlers, filtering, and bounded database loading
   intact. Use theme variables such as `--bg`, `--text`, `--text-muted`,
   `--control-border`, `--accent`, `--accent-glow`, and `--font-ui`.
4. Prefer correcting markup or reusing a class over adding a one-off CSS rule.
   Keep any necessary sizing or spacing rule local to its layout.

## Verify the actual appearance

- Check dark and light themes, unfocused and keyboard-focused states.
- Check a desktop sidebar and a narrow mobile viewport.
- Inspect computed background, text color, font, padding, border radius, focus
  border, and focus ring. A class name or passing unit test alone is not visual
  proof that an ancestor-dependent selector matches.
- Ensure the field is comfortably sized, fits its container, and causes no
  horizontal overflow. Compare standalone search geometry with the existing
  main sidebar search, rather than inventing unrelated dimensions.
- Confirm typing still filters results and load-more behavior remains intact.
- Run the existing tests covering changed renderers and theme behavior.
- If cached client assets changed, bump the service-worker cache version and
  update its existing version assertion.
