const BLOCKED_TAGS = new Set([
  'script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea',
  'select', 'option', 'meta', 'base', 'link', 'frame', 'frameset', 'applet'
])
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href'])

function unsafeUrl(value = '') {
  const compact = String(value).trim().replace(/[\u0000-\u001F\u007F\s]+/g, '').toLowerCase()
  if (!compact) return false
  if (compact.startsWith('javascript:') || compact.startsWith('vbscript:')) return true
  if (compact.startsWith('data:')) {
    return !/^data:image\/(png|gif|jpe?g|webp|bmp);base64,/i.test(String(value).trim())
  }
  return false
}

export function sanitizeEmailCss(css = '') {
  return String(css)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@charset\s+[^;]+;/gi, '')
    .replace(/@import\s+(?:url\s*\([^)]*\)|['"][^'"]*['"]|[^;]+)\s*;?/gi, '')
    .replace(/@font-face\s*\{[\s\S]*?\}/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/(?:behavior|-moz-binding)\s*:\s*[^;}]+[;}]?/gi, '')
    .replace(/url\s*\(\s*(['"]?)\s*(?:javascript|vbscript):[\s\S]*?\1\s*\)/gi, 'none')
}

export function sanitizeEmailDocument(html = '') {
  const parser = new DOMParser()
  const doc = parser.parseFromString(String(html), 'text/html')
  for (const element of [...doc.querySelectorAll('*')]) {
    const tag = element.tagName.toLowerCase()
    if (BLOCKED_TAGS.has(tag)) {
      element.remove()
      continue
    }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value || ''
      if (name.startsWith('on') || name === 'srcdoc') {
        element.removeAttribute(attribute.name)
        continue
      }
      if (URL_ATTRS.has(name) && unsafeUrl(value)) {
        element.removeAttribute(attribute.name)
        continue
      }
      if (name === 'style') {
        const cleaned = sanitizeEmailCss(value)
        if (cleaned.trim()) element.setAttribute('style', cleaned)
        else element.removeAttribute(attribute.name)
      }
    }
    if (tag === 'style') {
      element.textContent = sanitizeEmailCss(element.textContent || '')
      if (!element.textContent.trim()) element.remove()
    }
    if (tag === 'a') {
      element.setAttribute('rel', 'noopener noreferrer nofollow')
      element.setAttribute('target', '_blank')
    }
  }
  return doc
}

export function emailHtmlToText(html = '') {
  const doc = sanitizeEmailDocument(html)
  doc.querySelectorAll('style, title').forEach(node => node.remove())
  return (doc.body?.textContent || '').replace(/\s+/g, ' ').trim()
}

export function renderSafeEmailIntoShadow(shadowRoot, html = '') {
  const doc = sanitizeEmailDocument(html)
  const staticStyle = document.createElement('style')
  staticStyle.textContent = `
    :host { all: initial; width: 100%; height: 100%; font-family: -apple-system, Inter, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 14px; line-height: 1.5; color: #13181D; word-break: break-word; }
    h1, h2, h3, h4 { font-size: 18px; font-weight: 700; }
    p { margin: 0; }
    a { text-decoration: none; color: #0E70DF; }
    .shadow-content { background: #FFFFFF; width: fit-content; height: fit-content; min-width: 100%; }
    img:not(table img) { max-width: 100%; height: auto !important; }
  `
  const wrapper = document.createElement('div')
  wrapper.className = 'shadow-content'
  const bodyStyle = sanitizeEmailCss(doc.body?.getAttribute('style') || '')
  if (bodyStyle) wrapper.setAttribute('style', bodyStyle)
  const safeHeadStyles = [...(doc.head?.querySelectorAll('style') || [])].map(styleNode => {
    const style = document.createElement('style')
    style.textContent = sanitizeEmailCss(styleNode.textContent || '')
    return style
  }).filter(style => style.textContent.trim())
  for (const child of [...(doc.body?.childNodes || [])]) {
    wrapper.appendChild(document.importNode(child, true))
  }
  shadowRoot.replaceChildren(staticStyle, ...safeHeadStyles, wrapper)
}
