import React, { useEffect, useRef } from 'react';
import { Film } from 'lucide-react';
import { SmartImage } from './shared__components__StateViews.jsx';

export const MovieCarousel = React.memo(function MovieCarousel({ movies = [], onMovie, ariaLabel = '影视列表' }) {
  const ref = useRef(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const cards = [...node.querySelectorAll('[data-carousel-card]')];
    if (!cards.length) return;
    const observer = new IntersectionObserver(
      entries => entries.forEach(entry => {
        entry.target.dataset.active = entry.isIntersecting && entry.intersectionRatio >= 0.72 ? 'true' : 'false';
      }),
      { root: node, threshold: [0.25, 0.72, 0.95] }
    );
    cards.forEach(card => observer.observe(card));
    return () => observer.disconnect();
  }, [movies]);

  return (
    <div className="movie-carousel-wrap">
      <div className="movie-carousel" ref={ref} role="list" aria-label={ariaLabel} data-horizontal-scroll="true">
        {movies.map((movie, index) => {
          const title = movie?.title || movie?.name || '未命名';
          const updateInfo = movie?.updateInfo || movie?.remarks || movie?.vod_remarks || '';
          const is4K = /4k|2160p|超清|蓝光/i.test(`${title} ${updateInfo}`);

          return (
            <article
              className="movie-carousel-card"
              data-carousel-card
              data-active={index === 0 ? 'true' : 'false'}
              role="listitem"
              tabIndex={0}
              key={movie.contentId || movie.title || index}
              onClick={() => onMovie?.(movie)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onMovie?.(movie);
                }
              }}
            >
              <div className="movie-carousel-poster">
                <SmartImage
                  src={movie?.poster}
                  alt={title}
                  loading={index < 4 ? 'eager' : 'lazy'}
                  decoding="async"
                  fallback={
                    <div className="movie-carousel-placeholder">
                      <Film size={22} />
                    </div>
                  }
                />
                <div className="movie-card-gradient" aria-hidden="true" />
                {is4K && <span className="movie-card-quality-tag" aria-hidden="true">4K</span>}
                {movie?.rating && Number(movie.rating) > 0 && (
                  <span className="movie-card-rating" aria-label={`评分 ${movie.rating}`}>
                    ★ {movie.rating}
                  </span>
                )}
                {updateInfo && <span className="movie-card-badge" title={updateInfo}>{updateInfo}</span>}
              </div>
              <div className="movie-carousel-caption">
                <b title={title}>{title}</b>
                <span>
                  {movie?.year ? `${movie.year} · ` : ''}{movie?.category || '影视'}
                  {movie?.region ? ` · ${movie.region}` : ''}
                </span>
              </div>
            </article>
          );
        })}
      </div>
      {movies.length > 1 && (
        <div className="movie-carousel-hint" aria-hidden="true">
          <span>左右滑动</span>
          <i />
        </div>
      )}
    </div>
  );
});
