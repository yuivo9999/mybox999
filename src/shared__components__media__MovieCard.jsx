import React from 'react';
import { Film } from 'lucide-react';
import { SmartImage } from './shared__components__StateViews.jsx';

export const MovieCard = React.memo(function MovieCard({ movie, onClick, priority = false }) {
  if (!movie) return null;
  const title = movie.title || movie.name || '未命名';
  const year = movie.year || '';
  const category = movie.category || '';
  const updateInfo = movie.updateInfo || movie.remarks || movie.vod_remarks || '';
  const rating = movie.rating || movie.vod_score || '';
  const is4K = /4k|2160p|超清|蓝光/i.test(`${title} ${updateInfo}`);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick?.(movie);
    }
  };

  return (
    <article
      className="movie-card"
      role="button"
      tabIndex={0}
      onClick={() => onClick?.(movie)}
      onKeyDown={handleKeyDown}
      title={title}
      aria-label={`${title} ${updateInfo ? `(${updateInfo})` : ''}`}
    >
      <div className="movie-card-poster-wrap">
        <SmartImage
          src={movie.poster}
          alt={title}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          fallback={
            <div className="image-placeholder movie-card-placeholder">
              <Film size={24} />
            </div>
          }
        />
        <div className="movie-card-gradient" aria-hidden="true" />
        {is4K && (
          <span className="movie-card-quality-tag" aria-hidden="true">
            4K
          </span>
        )}
        {rating && Number(rating) > 0 && (
          <span className="movie-card-rating" aria-label={`评分 ${rating}`}>
            ★ {rating}
          </span>
        )}
        {updateInfo && (
          <span className="movie-card-badge" title={updateInfo}>
            {updateInfo}
          </span>
        )}
      </div>
      <div className="movie-card-meta">
        <b className="movie-card-title" title={title}>{title}</b>
        <span className="movie-card-sub">
          {year ? `${year} · ` : ''}{category || '影视'}
          {movie.region ? ` · ${movie.region}` : ''}
        </span>
      </div>
    </article>
  );
});
