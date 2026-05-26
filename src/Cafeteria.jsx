import { useEffect, useState } from 'react'
import { RefreshCcw, ExternalLink, UtensilsCrossed, AlertCircle } from 'lucide-react'

function relativeTime(ts) {
  if (!ts) return ''
  const ms = Date.now() - new Date(ts).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 1) return '방금'
  if (min < 60) return `${min}분 전`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}시간 전`
  const day = Math.floor(hr / 24)
  return `${day}일 전`
}

function formatPubDate(s) {
  if (!s) return ''
  try {
    return new Date(s).toLocaleDateString('ko-KR', {
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
    })
  } catch { return s }
}

export default function CafeteriaApp() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => { load(false) }, [])

  async function load(force) {
    setLoading(true); setError(null)
    try {
      const res = await window.oasis?.cafeteriaFetch(!!force)
      if (res?.error) setError(res.error)
      else setData(res)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  const latest = data?.latest

  return (
    <div className="h-full w-full flex flex-col bg-stone-50 text-stone-900">
      {/* 헤더 */}
      <header className="px-8 py-5 border-b border-stone-200 bg-white shrink-0 flex items-end justify-between gap-6">
        <div>
          <p className="eyebrow">구내식당</p>
          <h1 className="text-xl font-semibold tracking-tight mt-1">맘스푸드 식단표</h1>
          <p className="text-xs text-stone-400 mt-1">
            {data?.fetchedAt ? `${relativeTime(data.fetchedAt)} 업데이트` : '아직 불러오지 않음'}
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {latest?.link && (
            <button
              onClick={() => window.oasis?.openExternal(latest.link)}
              className="text-stone-500 hover:text-stone-900 flex items-center gap-1.5 underline-offset-4 hover:underline"
            >
              <ExternalLink className="w-3.5 h-3.5" /> 블로그에서 보기
            </button>
          )}
          <button
            onClick={() => load(true)}
            disabled={loading}
            className="px-3 py-1.5 bg-stone-900 hover:bg-stone-800 text-white text-xs flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCcw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            {loading ? '가져오는 중…' : '새로고침'}
          </button>
        </div>
      </header>

      {/* 본문 */}
      <main className="flex-1 overflow-auto thin-scroll">
        {error && (
          <div className="max-w-2xl mx-auto px-8 py-16 text-center">
            <AlertCircle className="w-10 h-10 mx-auto mb-3 text-rose-500" />
            <p className="font-medium">식단표를 가져오지 못했습니다</p>
            <p className="text-sm text-stone-500 mt-2 font-mono">{error}</p>
            <button onClick={() => load(true)} className="mt-5 text-sm underline underline-offset-4">
              다시 시도
            </button>
          </div>
        )}

        {!error && !data && loading && (
          <div className="max-w-2xl mx-auto px-8 py-16 text-center text-stone-400">
            <p className="text-sm">식단표 가져오는 중…</p>
          </div>
        )}

        {!error && data && !latest && (
          <div className="max-w-2xl mx-auto px-8 py-16 text-center text-stone-400">
            <UtensilsCrossed className="w-10 h-10 mx-auto mb-3 text-stone-300" />
            <p className="text-sm">식단표 게시물을 찾지 못했습니다</p>
            <button
              onClick={() => window.oasis?.openExternal(data.blogUrl)}
              className="mt-4 text-sm text-stone-900 underline underline-offset-4"
            >
              블로그 직접 열기
            </button>
          </div>
        )}

        {latest && (
          <div className="max-w-3xl mx-auto px-8 py-10">
            <h2 className="text-2xl font-semibold tracking-tight leading-snug">{latest.title}</h2>
            <p className="text-sm text-stone-500 mt-1.5">{formatPubDate(latest.pubDate)}</p>

            {latest.imageDataURL ? (
              <div className="mt-7">
                <img
                  src={latest.imageDataURL}
                  alt={latest.title}
                  onClick={() => window.oasis?.openExternal(latest.link)}
                  title="클릭하면 블로그에서 원본 크기로 열림"
                  className="block mx-auto max-w-full max-h-[65vh] object-contain border border-stone-200 cursor-zoom-in shadow-sm"
                />
                <p className="text-[11px] text-stone-400 text-center mt-2">
                  이미지 클릭 → 블로그에서 원본 크기
                </p>
              </div>
            ) : latest.imageUrl ? (
              <div className="mt-7 p-6 bg-stone-100 border border-stone-200 text-center text-sm text-stone-500">
                이미지를 미리 가져오지 못했습니다.
                <button
                  onClick={() => window.oasis?.openExternal(latest.link)}
                  className="block mx-auto mt-2 text-stone-900 underline underline-offset-4"
                >
                  블로그에서 직접 보기
                </button>
              </div>
            ) : null}

            {latest.text && (
              <div className="mt-7 text-[15px] leading-relaxed whitespace-pre-wrap text-stone-700">
                {latest.text}
              </div>
            )}
          </div>
        )}

        {/* 최근 식단표 목록 */}
        {data?.recent && data.recent.length > 1 && (
          <div className="max-w-3xl mx-auto px-8 pb-12">
            <p className="eyebrow mb-3">최근 식단표</p>
            <ul className="border-t border-stone-200">
              {data.recent.slice(1).map((p) => (
                <li key={p.link} className="py-3 border-b border-stone-200 flex items-center justify-between">
                  <span className="text-sm">{p.title}</span>
                  <button
                    onClick={() => window.oasis?.openExternal(p.link)}
                    className="text-xs text-stone-500 hover:text-stone-900 underline-offset-4 hover:underline flex items-center gap-1"
                  >
                    열기 <ExternalLink className="w-3 h-3" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </div>
  )
}
