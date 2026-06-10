/**
 * Sync: Naver 블로그 → Supabase
 *
 * 흐름:
 *   1. RSS 가져옴, 식단 게시물 추림
 *   2. DB 에 이미 있는 logNo 들 조회
 *   3. 새로 추가된 글만:
 *      a. PostView.naver 에서 원본 이미지 URL 추출
 *      b. 이미지 fetch → Supabase Storage 업로드
 *      c. menu_posts 테이블에 INSERT
 *   4. 결과 요약 반환
 *
 * 호출:
 *   - 수동: GET /api/sync
 *   - 자동: vercel.json 의 cron (daily)
 *   - On-demand: /api/cafeteria 가 stale 감지 시
 */

import { dbAdmin, STORAGE_BUCKET } from '../lib/supabase.js'
import { fetchRssItems, fetchOriginalImageUrl, fetchImageBuffer, isWeeklyMenuTitle } from '../lib/naver.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')

  if (!dbAdmin) {
    return res.status(500).json({
      error: 'SUPABASE_SERVICE_ROLE_KEY 환경 변수 누락 — Vercel 프로젝트 Settings → Environment Variables 에 추가',
    })
  }

  const result = await syncCafeteria()
  return res.status(result.error ? 500 : 200).json(result)
}

export async function syncCafeteria() {
  try {
    const items = await fetchRssItems()
    const menuItems = items.filter((i) => isWeeklyMenuTitle(i.title))
    if (menuItems.length === 0) {
      return { ok: true, added: [], skipped: [], note: '식단 게시물 없음' }
    }

    // 이미 DB에 있는 logNo 들 조회
    const logNos = menuItems.map((i) => i.logNo)
    const { data: existing, error: selectErr } = await dbAdmin
      .from('menu_posts')
      .select('id')
      .in('id', logNos)
    if (selectErr) throw selectErr
    const existingIds = new Set((existing || []).map((r) => r.id))

    const newItems = menuItems.filter((i) => !existingIds.has(i.logNo))
    if (newItems.length === 0) {
      return { ok: true, added: [], skipped: menuItems.map((i) => i.logNo), note: '신규 글 없음' }
    }

    const added = []
    const failed = []

    for (const item of newItems) {
      try {
        // 원본 이미지 URL
        const origUrl = await fetchOriginalImageUrl(item.logNo)
        let imagePath = null
        let imageUrl = null

        if (origUrl) {
          const imgData = await fetchImageBuffer(origUrl)
          if (imgData) {
            // Storage 업로드
            const ext = (imgData.contentType.match(/image\/(\w+)/)?.[1] || 'png').toLowerCase()
            imagePath = `${item.logNo}.${ext}`
            const { error: uploadErr } = await dbAdmin.storage
              .from(STORAGE_BUCKET)
              .upload(imagePath, imgData.buffer, {
                contentType: imgData.contentType,
                upsert: true,
              })
            if (uploadErr) throw uploadErr
            // 퍼블릭 URL
            const { data: pub } = dbAdmin.storage.from(STORAGE_BUCKET).getPublicUrl(imagePath)
            imageUrl = pub.publicUrl
          }
        }

        // DB INSERT
        const { error: insertErr } = await dbAdmin.from('menu_posts').insert({
          id: item.logNo,
          title: item.title,
          link: item.link,
          pub_date: item.pubDate ? new Date(item.pubDate).toISOString() : null,
          text_content: item.text,
          image_url: imageUrl,
          original_image_url: origUrl,
          image_path: imagePath,
        })
        if (insertErr) throw insertErr

        added.push({ id: item.logNo, title: item.title, hasImage: !!imageUrl })
      } catch (err) {
        failed.push({ id: item.logNo, error: err.message || String(err) })
      }
    }

    return { ok: true, added, failed, totalScanned: menuItems.length }
  } catch (err) {
    return { ok: false, error: err.message || String(err) }
  }
}
