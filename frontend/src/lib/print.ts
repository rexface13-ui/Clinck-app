interface ClinicProfile {
  name: string
  phone: string
  address: string
  logo: string
  footerNote?: string
}

/**
 * Prints an arbitrary HTML fragment inside a hidden iframe with a clinic
 * letterhead — isolated from the app's own styles/layout so what prints is
 * exactly what's composed here, nothing from the surrounding page leaks in.
 */
export function printDocument(title: string, bodyHtml: string, clinic: ClinicProfile) {
  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '-10000px'
  iframe.style.bottom = '-10000px'
  document.body.appendChild(iframe)

  const doc = iframe.contentWindow?.document
  if (!doc) return

  doc.open()
  doc.write(`<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color: #1a1a1a; padding: 24px 32px; }
  .header { display: flex; align-items: center; gap: 16px; border-bottom: 2px solid #2f5d4f; padding-bottom: 12px; margin-bottom: 20px; }
  .header img { width: 56px; height: 56px; object-fit: contain; }
  .header h1 { margin: 0; font-size: 20px; }
  .header p { margin: 2px 0 0; font-size: 12px; color: #555; }
  h2.doc-title { font-size: 16px; margin: 0 0 16px; color: #2f5d4f; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th, td { border: 1px solid #ddd; padding: 8px 10px; font-size: 13px; text-align: right; }
  th { background: #f3f6f5; }
  .meta { font-size: 13px; color: #444; margin-bottom: 16px; display: flex; flex-wrap: wrap; gap: 16px; }
  .meta span b { color: #1a1a1a; }
  .total-row td { font-weight: bold; }
  .signature { margin-top: 60px; display: flex; justify-content: space-between; font-size: 13px; }
  .signature div { border-top: 1px solid #999; padding-top: 6px; width: 200px; text-align: center; }
  .footer-note { margin-top: 24px; padding-top: 12px; border-top: 1px solid #ddd; font-size: 12px; color: #666; text-align: center; }
  @media print { body { padding: 0 24px; } }
</style>
</head>
<body>
  <div class="header">
    ${clinic.logo ? `<img src="${clinic.logo}" alt="شعار" />` : ''}
    <div>
      <h1>${escapeHtml(clinic.name || 'العيادة')}</h1>
      <p>${[clinic.address, clinic.phone].filter(Boolean).map(escapeHtml).join(' — ')}</p>
    </div>
  </div>
  <h2 class="doc-title">${escapeHtml(title)}</h2>
  ${bodyHtml}
  ${clinic.footerNote ? `<div class="footer-note">${escapeHtml(clinic.footerNote)}</div>` : ''}
</body>
</html>`)
  doc.close()

  iframe.onload = () => {
    iframe.contentWindow?.focus()
    iframe.contentWindow?.print()
    setTimeout(() => document.body.removeChild(iframe), 1000)
  }
}

function escapeHtml(s: string): string {
  const div = document.createElement('div')
  div.textContent = s
  return div.innerHTML
}

export function metaRow(pairs: [string, string][]): string {
  return `<div class="meta">${pairs.map(([label, value]) => `<span><b>${escapeHtml(label)}:</b> ${escapeHtml(value)}</span>`).join('')}</div>`
}
