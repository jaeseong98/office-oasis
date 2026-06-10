/**
 * 읽기 엔드포인트 — DB 에서 식단 데이터 반환.
 * DB 최신 글이 6시간 이상 stale 이면 자동 sync 한 번 시도.
 *
 * 응답 형태:
 *   {
 *     latest: { id, title, link, pub_date, text_content, image_url, ... },
 *     history: [{ id, title, link, pub_date, image_url }, ...],
 *     blogUrl, generatedAt
 *   }
 */

import { dbRead } from '../lib/supabase.js'
import { syncCafeteria } from './sync.js'

const STALE_AFTER_MS = 6 * 60 * 60 * 1000

export default async function handler(req, res) {
  // CDN 캐시 15분 (사용자 새로고침 부담 ↓), stale-while-revalidate 1시간
  res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')

  try {
    const posts = await readPosts()
    const latest = posts[0]
    const isStale = !latest || (latest.created_at && Date.now() - new Date(latest.created_at).getTime() > STALE_AFTER_MS)

    if (isStale) {
      // 동기 sync 시도. 실패해도 응답은 계속.
      const syncResult = await syncCafeteria()
      if (syncResult.ok && (syncResult.added?.length || 0) > 0) {
        const refreshed = await readPosts()
        return respond(res, refreshed)
      }
    }

    return respond(res, posts)
  } catch (err) {
    res.setHeader('Cache-Control', 'no-cache')
    return res.status(500).json({ error: err.message || String(err) })
  }
}

async function readPosts() {
  const { data, error } = await dbRead
    .from('menu_posts')
    .select('id, title, link, pub_date, text_content, image_url, original_image_url, created_at')
    .order('pub_date', { ascending: false })
    .limit(12)
  if (error) throw error
  return data || []
}

function respond(res, posts) {
  return res.status(200).json({
    latest: posts[0] || null,
    history: posts.slice(1),
    blogUrl: 'https://blog.naver.com/momsfood_',
    generatedAt: new Date().toISOString(),
  })
}
