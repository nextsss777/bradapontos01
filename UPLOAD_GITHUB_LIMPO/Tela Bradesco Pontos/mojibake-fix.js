(function() {
  const brokenPattern = /[\u00c3\u00c2]|\u00e2[\u0080\u20ac]|\ufffd/;
  const manualFixes = [
    [new RegExp('\u00e2\u20ac\u201d', 'g'), '—'],
    [new RegExp('\u00e2\u20ac\u201c', 'g'), '–'],
    [new RegExp('\u00e2\u20ac\u00a6', 'g'), '…'],
    [new RegExp('\u00e2\u20ac\u02dc', 'g'), '‘'],
    [new RegExp('\u00e2\u20ac\u2122', 'g'), '’'],
    [new RegExp('\u00e2\u20ac\u0153', 'g'), '“'],
    [new RegExp('\u00e2\u20ac\\ufffd', 'g'), '”'],
    [new RegExp('\u00c2 ', 'g'), ' '],
    [new RegExp('\u00c2', 'g'), '']
  ];

  function decodeOnce(value) {
    try {
      const bytes = new Uint8Array([...value].map(char => {
        const code = char.charCodeAt(0);
        if (code > 255) throw new Error('not-latin1');
        return code;
      }));
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      return value;
    }
  }

  function fixText(value) {
    if (!value || !brokenPattern.test(value)) return value;

    let current = value;
    for (let i = 0; i < 4; i += 1) {
      const next = decodeOnce(current);
      if (next === current) break;
      current = next;
    }

    manualFixes.forEach(([pattern, replacement]) => {
      current = current.replace(pattern, replacement);
    });

    return current;
  }

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      node.nodeValue = fixText(node.nodeValue);
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    [...node.attributes].forEach(attribute => {
      const fixed = fixText(attribute.value);
      if (fixed !== attribute.value) {
        node.setAttribute(attribute.name, fixed);
      }
    });

    node.childNodes.forEach(walk);
  }

  function run() {
    walk(document.body);
    document.title = fixText(document.title);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
