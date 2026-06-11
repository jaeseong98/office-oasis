// Naver 블로그 크롤링 공통 헬퍼

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 OfficeOasisMenuMirror'
const RSS_URL = 'https://rss.blog.naver.com/momsfood_.xml'

function stripCdata(s) {
  if (!s) return ''
  return s.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim()
}

function parseRssItem(body) {
  const get = (re) => stripCdata(body.match(re)?.[1] || '')
  const title = get(/<title>([\s\S]*?)<\/title>/)
  const link = get(/<link>([\s\S]*?)<\/link>/)
  const pubDate = get(/<pubDate>([\s\S]*?)<\/pubDate>/)
  const description = stripCdata(body.match(/<description>([\s\S]*?)<\/description>/)?.[1] || '')
  const text = description
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()

  // logNo 추출
  const logNoMatch = link.match(/momsfood_\/(\d+)/)
  const logNo = logNoMatch ? logNoMatch[1] : null

  return { logNo, title, link, pubDate, text }
}

export async function fetchRssItems() {
  const r = await fetch(RSS_URL, { headers: { 'User-Agent': UA } })
  if (!r.ok) throw new Error(`RSS HTTP ${r.status}`)
  const xml = await r.text()
  const items = []
  const itemRe = /<item>([\s\S]*?)<\/item>/g
  let m
  while ((m = itemRe.exec(xml)) !== null) {
    const parsed = parseRssItem(m[1])
    if (parsed.logNo && parsed.title) items.push(parsed)
  }
  return items
}

function upgradeNaverImageSize(url) {
  if (!url) return url
  // ?type=wNNN 또는 &type=wNNN 을 더 큰 사이즈로 교체. 없으면 추가.
  if (/[?&]type=w\d+/.test(url)) {
    return url.replace(/([?&])type=w\d+/, '$1type=w3840')
  }
  return url + (url.includes('?') ? '&' : '?') + 'type=w3840'
}

export async function fetchOriginalImageUrl(logNo) {
  if (!logNo) return null
  try {
    const viewUrl = `https://blog.naver.com/PostView.naver?blogId=momsfood_&logNo=${logNo}`
    const r = await fetch(viewUrl, { headers: { 'User-Agent': UA } })
    if (!r.ok) return null
    const html = await r.text()
    const m = html.match(/<img[^>]+src=["'](https?:\/\/(?:postfiles|blogfiles)\.pstatic\.net\/[^"']+)["']/i)
    return upgradeNaverImageSize(m?.[1] || null)
  } catch {
    return null
  }
}

export async function fetchImageBuffer(url) {
  if (!url) return null
  try {
    const r = await fetch(url, {
      headers: { Referer: 'https://blog.naver.com/', 'User-Agent': UA },
    })
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length > 8 * 1024 * 1024) return null
    const contentType = (r.headers.get('content-type') || 'image/png').split(';')[0].trim()
    return { buffer: buf, contentType }
  } catch {
    return null
  }
}

export function isWeeklyMenuTitle(title) {
  return /식단|메뉴/.test(title || '')
}
